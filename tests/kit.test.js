import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import fc from 'fast-check';
import { capture, compareCase, compareRuns, loadProject, report, sha256 } from '../src/kit.js';
import { planTriage, triage } from '../src/triage.js';
import { startDemoServer } from '../fixtures/demo-app.js';

const source = resolve('examples/demo');
const execFileAsync = promisify(execFile);

async function makeProject(t, originalUrl, candidateUrl) {
  const root = await mkdtemp(join(tmpdir(), 'rea-kit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'cases'));
  const target = JSON.parse(await readFile(join(source, 'target.json'), 'utf8'));
  target.original.base_url = originalUrl;
  target.candidate.base_url = candidateUrl;
  await writeFile(join(root, 'target.json'), JSON.stringify(target));
  await writeFile(join(root, 'cases', 'add-and-reload.json'), await readFile(join(source, 'cases', 'add-and-reload.json')));
  return root;
}

test('identical behavior passes, while a missing Evidence reference leaves the claim open', async t => {
  const original = await startDemoServer();
  const candidate = await startDemoServer();
  t.after(() => original.server.close());
  t.after(() => candidate.server.close());
  const root = await makeProject(t, original.baseUrl, candidate.baseUrl);
  await capture(root, 'add-and-reload', 'original');
  await capture(root, 'add-and-reload', 'candidate');
  const comparison = await compareCase(root, 'add-and-reload');
  assert.equal(comparison.status, 'pass');
  const coverage = await report(root);
  assert.equal(coverage.status, 'open');
  assert.match(coverage.claims[0].reasons.join(' '), /missing original Evidence reference/);
});

test('a changed state transition is localized to its first observed step', async t => {
  const original = await startDemoServer({ increment: 1 });
  const candidate = await startDemoServer({ increment: 2 });
  t.after(() => original.server.close());
  t.after(() => candidate.server.close());
  const root = await makeProject(t, original.baseUrl, candidate.baseUrl);
  await capture(root, 'add-and-reload', 'original');
  await capture(root, 'add-and-reload', 'candidate');
  const comparison = await compareCase(root, 'add-and-reload');
  assert.equal(comparison.status, 'changed');
  assert.equal(comparison.differences[0].step_id, 'add');
  assert.equal(comparison.differences[0].original, '1');
  assert.equal(comparison.differences[0].candidate, '2');
});

test('stale target or case metadata cannot produce a pass', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const project = await loadProject(root);
  const testCase = project.cases.get('add-and-reload');
  const wrong = { schema: 'reconstruction-run/v1', project_id: project.target.id, manifest_sha256: 'old', case_id: testCase.id, case_sha256: 'old', side: 'original', target: { version: '0', artifact_sha256: null }, steps: [] };
  const comparison = compareRuns(project, testCase, wrong, { ...wrong, side: 'candidate' });
  assert.equal(comparison.status, 'unknown');
  assert.match(comparison.reasons.join(' '), /stale/);
});

test('original and candidate must resolve to different app origins', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:4179', 'http://127.0.0.1:4179/other-path');
  await assert.rejects(loadProject(root), /original and candidate need different app origins/);
  const targetPath = join(root, 'target.json');
  const target = JSON.parse(await readFile(targetPath, 'utf8'));
  target.candidate.base_url = 'http://127.0.0.1:4180';
  await writeFile(targetPath, JSON.stringify(target));
  assert.equal((await loadProject(root)).target.candidate.base_url, target.candidate.base_url);
});

test('capture closes the browser when context setup fails', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const closed = [];
  const browserType = { launch: async () => ({
    newContext: async () => { throw new Error('context setup failed'); },
    close: async () => { closed.push('browser'); }
  }) };
  await assert.rejects(capture(root, 'add-and-reload', 'original', { browserType }), /context setup failed/);
  assert.deepEqual(closed, ['browser']);
});

test('capture keeps the first failure and closes resources after trace cleanup fails', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const closed = [];
  const browserType = { launch: async () => ({
    newContext: async () => ({
      tracing: {
        start: async () => { closed.push('trace-start'); },
        stop: async () => { closed.push('trace-stop'); throw new Error('trace stop failed'); }
      },
      newPage: async () => { throw new Error('page setup failed'); },
      close: async () => { closed.push('context'); }
    }),
    close: async () => { closed.push('browser'); }
  }) };
  await assert.rejects(capture(root, 'add-and-reload', 'original', { trace: true, browserType }), /page setup failed/);
  assert.deepEqual(closed, ['trace-start', 'trace-stop', 'context', 'browser']);
});

test('claim edits preserve captures while source and environment edits invalidate them', async t => {
  const original = await startDemoServer();
  const candidate = await startDemoServer();
  t.after(() => original.server.close());
  t.after(() => candidate.server.close());
  const root = await makeProject(t, original.baseUrl, candidate.baseUrl);
  await capture(root, 'add-and-reload', 'original');
  await capture(root, 'add-and-reload', 'candidate');
  const project = await loadProject(root);
  const runs = await Promise.all(['original', 'candidate'].map(async side => {
    const run = JSON.parse(await readFile(join(root, 'runs', `add-and-reload.${side}.json`), 'utf8'));
    delete run.capture_config_sha256;
    return run;
  }));
  assert.equal(compareRuns(project, project.cases.get('add-and-reload'), ...runs).status, 'pass');

  const targetPath = join(root, 'target.json');
  const target = JSON.parse(await readFile(targetPath, 'utf8'));
  target.claims[0].title = 'Updated description';
  target.claims[0].evidence_refs = [{ file: 'evidence/behavior.json', evidence_id: `ev_${'a'.repeat(64)}` }];
  await writeFile(targetPath, JSON.stringify(target));
  assert.equal((await compareCase(root, 'add-and-reload', { save: false })).status, 'pass');

  target.original.version = '2.0.0';
  await writeFile(targetPath, JSON.stringify(target));
  const sourceChanged = await compareCase(root, 'add-and-reload', { save: false });
  assert.equal(sourceChanged.status, 'unknown');
  assert.ok(sourceChanged.reasons.some(reason => reason.includes('original run uses a stale capture configuration')));
  assert.ok(sourceChanged.reasons.every(reason => !reason.includes('candidate run uses a stale capture configuration')));

  target.original.version = '1.0.0';
  target.environment.locale = 'fr-FR';
  await writeFile(targetPath, JSON.stringify(target));
  const environmentChanged = await compareCase(root, 'add-and-reload', { save: false });
  assert.equal(environmentChanged.status, 'unknown');
  assert.equal(environmentChanged.reasons.filter(reason => reason.includes('stale capture configuration')).length, 2);
});

test('triage converts comparison and REA closure findings into ordered next actions', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const initial = await triage(root);
  assert.equal(initial.status, 'open');
  assert.equal(initial.tasks[0].kind, 'refresh-captures');
  const project = await loadProject(root);
  const local = await report(root);
  const rea = {
    boundary_id: 'demo-boundary', status: 'failed', evidence_ids: [],
    reasons: [{ code: 'verifier-failed', subject_id: 'count-persists', detail: 'Replay differs' }],
    recommended_probes: [{ operation: 'capture_browser_scenario', subject_id: 'count-persists', rationale: 'Repeat the click sequence' }]
  };
  const result = planTriage(project, local, [['add-and-reload', {
    status: 'changed', reasons: [], differences: [{ step_id: 'add', observation: 'count', original: '1', candidate: '2' }]
  }]], rea);
  assert.equal(result.status, 'changed');
  assert.equal(result.tasks[0].kind, 'debug-difference');
  assert.match(result.tasks[0].detail, /add\/count/);
  assert.ok(result.tasks.some(task => task.kind === 'rea-probe' && task.detail.includes('capture_browser_scenario')));
});

test('duplicate step IDs are rejected before capture', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const path = join(root, 'cases', 'add-and-reload.json');
  const item = JSON.parse(await readFile(path, 'utf8'));
  item.steps[1].id = item.steps[0].id;
  await writeFile(path, JSON.stringify(item));
  await assert.rejects(loadProject(root), /Duplicate step ID/);
});

test('case paths cannot navigate away from the configured app site', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const path = join(root, 'cases', 'add-and-reload.json');
  const item = JSON.parse(await readFile(path, 'utf8'));
  item.initial_path = '//outside.example/path';
  await writeFile(path, JSON.stringify(item));
  await assert.rejects(loadProject(root), /initial_path: path must stay/);
  item.initial_path = '/';
  item.steps[1].action = 'navigate';
  item.steps[1].path = '/\\outside.example/path';
  await writeFile(path, JSON.stringify(item));
  await assert.rejects(loadProject(root), /add: path must stay/);
});

test('Evidence paths on another Windows drive are rejected', { skip: process.platform !== 'win32' }, async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const path = join(root, 'target.json');
  const target = JSON.parse(await readFile(path, 'utf8'));
  target.claims[0].evidence_refs = [{ file: 'D:\\outside\\evidence.json', evidence_id: `ev_${'a'.repeat(64)}` }];
  await writeFile(path, JSON.stringify(target));
  const result = await report(root);
  assert.ok(result.claims[0].reasons.some(reason => reason.includes('Path escapes project')));
});

test('missing or modified screenshot artifacts cannot pass a comparison', async t => {
  const original = await startDemoServer();
  const candidate = await startDemoServer();
  t.after(() => original.server.close());
  t.after(() => candidate.server.close());
  const root = await makeProject(t, original.baseUrl, candidate.baseUrl);
  const originalCapture = await capture(root, 'add-and-reload', 'original');
  await capture(root, 'add-and-reload', 'candidate');
  assert.equal((await compareCase(root, 'add-and-reload', { save: false })).status, 'pass');
  const asset = join(root, originalCapture.result.artifacts['restart-page/screen']);
  await rm(asset);
  const missing = await compareCase(root, 'add-and-reload', { save: false });
  assert.equal(missing.status, 'unknown');
  assert.match(missing.reasons.join(' '), /screenshot restart-page\/screen artifact cannot be read/);
  await writeFile(asset, 'modified PNG bytes');
  const modified = await compareCase(root, 'add-and-reload', { save: false });
  assert.equal(modified.status, 'unknown');
  assert.match(modified.reasons.join(' '), /artifact digest differs/);
});

test('different generated observations cannot be reported as a pass', async t => {
  const root = await makeProject(t, 'http://127.0.0.1:1', 'http://127.0.0.1:2');
  const project = await loadProject(root);
  const testCase = project.cases.get('add-and-reload');
  const steps = testCase.steps.map(step => ({
    id: step.id,
    observations: Object.fromEntries(step.observations.map(item => [item.name, 'same']))
  }));
  const makeRun = side => ({
    schema: 'reconstruction-run/v1',
    project_id: project.target.id,
    manifest_sha256: project.manifest_sha256,
    case_id: testCase.id,
    case_sha256: sha256(testCase),
    side,
    target: { version: project.target[side].version, artifact_sha256: null },
    steps: structuredClone(steps)
  });
  await fc.assert(fc.asyncProperty(fc.string(), fc.string(), async (left, right) => {
    fc.pre(left !== right);
    const original = makeRun('original');
    const candidate = makeRun('candidate');
    original.steps[1].observations.count = left;
    candidate.steps[1].observations.count = right;
    const result = compareRuns(project, testCase, original, candidate);
    assert.equal(result.status, 'changed');
    assert.equal(result.differences[0].step_id, 'add');
  }), { numRuns: 100 });
});

test('the public CLI captures and compares a real browser case', async t => {
  const original = await startDemoServer();
  const candidate = await startDemoServer();
  t.after(() => original.server.close());
  t.after(() => candidate.server.close());
  const root = await makeProject(t, original.baseUrl, candidate.baseUrl);
  for (const side of ['original', 'candidate']) {
    const args = ['src/cli.js', 'capture', root, 'add-and-reload', side];
    if (side === 'original') args.push('--trace');
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: resolve('.') });
    assert.equal(JSON.parse(stdout).result.side, side);
  }
  assert.ok((await stat(join(root, 'runs', 'assets', 'add-and-reload', 'original', 'trace.zip'))).size > 0);
  assert.ok((await stat(join(root, 'runs', 'assets', 'add-and-reload', 'candidate', 'restart-page-screen.png'))).size > 0);
  const { stdout } = await execFileAsync(process.execPath, ['src/cli.js', 'compare', root, 'add-and-reload'], { cwd: resolve('.') });
  assert.equal(JSON.parse(stdout).status, 'pass');
});
