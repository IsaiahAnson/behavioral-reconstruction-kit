import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { explainSchemaErrors, validateCase, validateTarget } from './schema.js';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
}

export function captureConfigSha256(target, side) {
  const endpoint = target[side];
  return sha256({
    project_id: target.id,
    side,
    base_url: endpoint.base_url,
    version: endpoint.version,
    artifact_sha256: endpoint.artifact_sha256 ?? null,
    environment: {
      viewport: target.environment?.viewport ?? { width: 1280, height: 800 },
      locale: target.environment?.locale ?? 'en-US',
      timezone_id: target.environment?.timezone_id ?? 'UTC'
    }
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

function isWithin(root, child) {
  const rel = relative(root, child);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

async function within(root, child) {
  const full = resolve(root, child);
  if (!isWithin(resolve(root), full)) throw new Error(`Path escapes project: ${child}`);
  const [realRoot, realChild] = await Promise.all([realpath(root), realpath(full)]);
  if (!isWithin(realRoot, realChild)) throw new Error(`Path escapes project: ${child}`);
  return realChild;
}

function validateCasePath(target, path, context) {
  if (path.startsWith('//') || path.startsWith('/\\')) throw new Error(`${context}: path must stay on the configured app site`);
  for (const side of ['original', 'candidate']) {
    const base = new URL(target[side].base_url);
    let resolved;
    try { resolved = new URL(path, base); }
    catch { throw new Error(`${context}: invalid ${side} path`); }
    if (resolved.origin !== base.origin) throw new Error(`${context}: path leaves the ${side} app site`);
  }
}

export async function loadProject(projectDir) {
  const root = resolve(projectDir);
  const target = await readJson(join(root, 'target.json'));
  if (!validateTarget(target)) throw new Error(`target.json: ${explainSchemaErrors(validateTarget)}`);
  const endpoints = {};
  for (const side of ['original', 'candidate']) {
    try { endpoints[side] = new URL(target[side].base_url); }
    catch { throw new Error(`target.json: ${side}.base_url is invalid`); }
  }
  if (endpoints.original.origin === endpoints.candidate.origin) {
    throw new Error('target.json: original and candidate need different app origins (host or port)');
  }
  const caseDir = join(root, 'cases');
  const files = (await readdir(caseDir)).filter(file => file.endsWith('.json')).sort();
  const cases = new Map();
  for (const file of files) {
    const item = await readJson(join(caseDir, file));
    if (!validateCase(item)) throw new Error(`${file}: ${explainSchemaErrors(validateCase)}`);
    if (file !== `${item.id}.json`) throw new Error(`Case filename must be ${item.id}.json`);
    if (cases.has(item.id)) throw new Error(`Duplicate case: ${item.id}`);
    const stepIds = item.steps.map(step => step.id);
    if (new Set(stepIds).size !== stepIds.length) throw new Error(`Duplicate step ID in ${item.id}`);
    validateCasePath(target, item.initial_path, `${item.id}/initial_path`);
    for (const step of item.steps) {
      const names = step.observations.map(observation => observation.name);
      if (new Set(names).size !== names.length) throw new Error(`Duplicate observation name in ${item.id}/${step.id}`);
      validateStep(item.id, step);
      if (step.action === 'navigate') validateCasePath(target, step.path, `${item.id}/${step.id}`);
    }
    cases.set(item.id, item);
  }
  const claimIds = target.claims.map(claim => claim.id);
  if (new Set(claimIds).size !== claimIds.length) throw new Error('Duplicate claim ID');
  for (const claim of target.claims) {
    for (const caseId of claim.case_ids) if (!cases.has(caseId)) throw new Error(`Claim ${claim.id} names missing case ${caseId}`);
  }
  return { root, target, cases, manifest_sha256: sha256(target) };
}

function locatorFor(item, side) {
  return item[`${side}_locator`] ?? item.locator;
}

function validateStep(caseId, step) {
  if (['click', 'fill', 'press', 'wait_for'].includes(step.action) && !step.locator && !(step.original_locator && step.candidate_locator)) {
    throw new Error(`${caseId}/${step.id}: action needs a locator for both sides`);
  }
  if (['fill', 'press'].includes(step.action) && typeof step.value !== 'string') throw new Error(`${caseId}/${step.id}: action needs value`);
  if (step.action === 'navigate' && !step.path) throw new Error(`${caseId}/${step.id}: navigate needs path`);
  for (const observation of step.observations) {
    if (['text', 'value', 'visible'].includes(observation.kind) && !observation.locator && !(observation.original_locator && observation.candidate_locator)) {
      throw new Error(`${caseId}/${step.id}/${observation.name}: observation needs a locator for both sides`);
    }
    if (observation.kind === 'local_storage' && !observation.key) throw new Error(`${caseId}/${step.id}/${observation.name}: local_storage needs key`);
  }
}

function makeLocator(page, descriptor) {
  if (!descriptor) throw new Error('Missing locator');
  switch (descriptor.kind) {
    case 'css': if (!descriptor.selector) throw new Error('CSS locator needs selector'); return page.locator(descriptor.selector);
    case 'role': if (!descriptor.role) throw new Error('Role locator needs role'); return page.getByRole(descriptor.role, descriptor.name ? { name: descriptor.name } : {});
    case 'text': if (!descriptor.name) throw new Error('Text locator needs name'); return page.getByText(descriptor.name);
    case 'label': if (!descriptor.name) throw new Error('Label locator needs name'); return page.getByLabel(descriptor.name);
    case 'testid': if (!descriptor.name) throw new Error('Test ID locator needs name'); return page.getByTestId(descriptor.name);
    default: throw new Error(`Unknown locator kind: ${descriptor.kind}`);
  }
}

async function observe(page, observation, side) {
  switch (observation.kind) {
    case 'text': return await makeLocator(page, locatorFor(observation, side)).innerText();
    case 'value': return await makeLocator(page, locatorFor(observation, side)).inputValue();
    case 'visible': return await makeLocator(page, locatorFor(observation, side)).isVisible();
    case 'url_path': {
      const url = new URL(page.url());
      return `${url.pathname}${url.search}${url.hash}`;
    }
    case 'local_storage': return await page.evaluate(key => localStorage.getItem(key), observation.key);
    case 'screenshot': throw new Error('Screenshot observations are handled by capture');
    default: throw new Error(`Unknown observation kind: ${observation.kind}`);
  }
}

async function act(page, step, side, baseUrl) {
  const locator = ['click', 'fill', 'press', 'wait_for'].includes(step.action) ? makeLocator(page, locatorFor(step, side)) : null;
  switch (step.action) {
    case 'observe': break;
    case 'click': await locator.click(); break;
    case 'fill': await locator.fill(step.value); break;
    case 'press': await locator.press(step.value); break;
    case 'reload': await page.reload(); break;
    case 'navigate': await page.goto(new URL(step.path, baseUrl).href); break;
    case 'wait_for': await locator.waitFor({ state: 'visible' }); break;
    default: throw new Error(`Unknown action: ${step.action}`);
  }
}

export async function capture(projectDir, caseId, side, options = {}) {
  if (!['original', 'candidate'].includes(side)) throw new Error('Side must be original or candidate');
  const project = await loadProject(projectDir);
  const testCase = project.cases.get(caseId);
  if (!testCase) throw new Error(`Unknown case: ${caseId}`);
  const target = project.target[side];
  const baseUrl = new URL(target.base_url);
  const browser = await (options.browserType ?? chromium).launch({ headless: true });
  let context;
  let tracingStarted = false;
  let captureError;
  const captureId = randomUUID();
  const assetDir = join(project.root, 'runs', 'assets', caseId, side, captureId);
  try {
    context = await browser.newContext({
      viewport: project.target.environment?.viewport ?? { width: 1280, height: 800 },
      locale: project.target.environment?.locale ?? 'en-US',
      timezoneId: project.target.environment?.timezone_id ?? 'UTC'
    });
    if (options.trace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
    }
    const page = await context.newPage();
    await page.goto(new URL(testCase.initial_path, baseUrl).href);
    const steps = [];
    const artifacts = {};
    for (const step of testCase.steps) {
      await act(page, step, side, baseUrl);
      const observations = {};
      for (const item of step.observations) {
        if (item.kind === 'screenshot') {
          await mkdir(assetDir, { recursive: true });
          const path = join(assetDir, `${step.id}-${item.name}.png`);
          const bytes = await page.screenshot({ path });
          observations[item.name] = createHash('sha256').update(bytes).digest('hex');
          artifacts[`${step.id}/${item.name}`] = relative(project.root, path).replaceAll('\\', '/');
        } else {
          observations[item.name] = await observe(page, item, side);
        }
      }
      steps.push({ id: step.id, observations });
    }
    const result = {
      schema: 'reconstruction-run/v1',
      capture_id: captureId,
      project_id: project.target.id,
      manifest_sha256: project.manifest_sha256,
      capture_config_sha256: captureConfigSha256(project.target, side),
      case_id: caseId,
      case_sha256: sha256(testCase),
      side,
      target: { name: target.name, version: target.version, artifact_sha256: target.artifact_sha256 ?? null },
      captured_at: new Date().toISOString(),
      trace_path: options.trace ? relative(project.root, join(assetDir, 'trace.zip')).replaceAll('\\', '/') : null,
      artifacts,
      steps
    };
    const output = options.output ?? join(project.root, 'runs', `${caseId}.${side}.json`);
    await writeJsonAtomic(output, result);
    return { output, result };
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (context && tracingStarted) {
      try {
        await mkdir(assetDir, { recursive: true });
        await context.tracing.stop({ path: join(assetDir, 'trace.zip') });
      } catch (error) { cleanupErrors.push(error); }
    }
    if (context) {
      try { await context.close(); }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await browser.close(); }
    catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length && !captureError) throw new AggregateError(cleanupErrors, 'Failed to close capture browser resources');
  }
}

export function compareRuns(project, testCase, original, candidate) {
  const expectedDigest = sha256(testCase);
  const problems = [];
  for (const [side, run] of [['original', original], ['candidate', candidate]]) {
    if (run?.schema === 'reconstruction-run-failure/v1' && run.project_id === project.target.id && run.case_id === testCase.id && run.side === side) {
      problems.push(`${side} capture failed: ${run.error}`);
      continue;
    }
    if (!run || run.schema !== 'reconstruction-run/v1' || run.project_id !== project.target.id || run.side !== side || run.case_id !== testCase.id) {
      problems.push(`${side} run identity is missing or invalid`);
      continue;
    }
    if (Object.hasOwn(run, 'capture_config_sha256')) {
      if (run.capture_config_sha256 !== captureConfigSha256(project.target, side)) problems.push(`${side} run uses a stale capture configuration`);
    } else if (run.manifest_sha256 !== project.manifest_sha256) {
      problems.push(`${side} run uses a stale target manifest`);
    }
    if (run.case_sha256 !== expectedDigest) problems.push(`${side} run uses a stale case definition`);
    if (run.target?.version !== project.target[side].version || run.target?.artifact_sha256 !== (project.target[side].artifact_sha256 ?? null)) {
      problems.push(`${side} run uses a different target version or artifact digest`);
    }
  }
  if (problems.length) return { schema: 'reconstruction-comparison/v1', case_id: testCase.id, status: 'unknown', reasons: problems, differences: [] };
  const differences = [];
  if (!Array.isArray(original.steps) || !Array.isArray(candidate.steps) || original.steps.length !== testCase.steps.length || candidate.steps.length !== testCase.steps.length) {
    return { schema: 'reconstruction-comparison/v1', case_id: testCase.id, status: 'unknown', reasons: ['Step inventory is incomplete'], differences };
  }
  for (let i = 0; i < testCase.steps.length; i++) {
    const expected = testCase.steps[i];
    const left = original.steps[i];
    const right = candidate.steps[i];
    if (left?.id !== expected.id || right?.id !== expected.id || !left.observations || !right.observations) {
      return { schema: 'reconstruction-comparison/v1', case_id: testCase.id, status: 'unknown', reasons: [`Step ${expected.id} is missing or misaligned`], differences };
    }
    for (const observation of expected.observations) {
      const name = observation.name;
      if (!Object.hasOwn(left.observations, name) || !Object.hasOwn(right.observations, name)) {
        return { schema: 'reconstruction-comparison/v1', case_id: testCase.id, status: 'unknown', reasons: [`Observation ${expected.id}/${name} is missing`], differences };
      }
      if (JSON.stringify(left.observations[name]) !== JSON.stringify(right.observations[name])) {
        differences.push({ step_id: expected.id, observation: name, original: left.observations[name], candidate: right.observations[name] });
      }
    }
  }
  return { schema: 'reconstruction-comparison/v1', case_id: testCase.id, status: differences.length ? 'changed' : 'pass', reasons: [], differences };
}

async function readRun(project, caseId, side) {
  try { return await readJson(join(project.root, 'runs', `${caseId}.${side}.json`)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function compareLoadedCase(project, caseId) {
  const testCase = project.cases.get(caseId);
  if (!testCase) throw new Error(`Unknown case: ${caseId}`);
  const [original, candidate] = await Promise.all([
    readRun(project, caseId, 'original'),
    readRun(project, caseId, 'candidate')
  ]);
  const comparison = compareRuns(project, testCase, original, candidate);
  if (comparison.status === 'unknown') return comparison;
  const reasons = [];
  for (const [side, run] of [['original', original], ['candidate', candidate]]) {
    for (const step of testCase.steps) {
      for (const observation of step.observations.filter(item => item.kind === 'screenshot')) {
        const key = `${step.id}/${observation.name}`;
        const artifact = run.artifacts?.[key];
        if (typeof artifact !== 'string') {
          reasons.push(`${side} screenshot ${key} has no artifact path`);
          continue;
        }
        try {
          const bytes = await readFile(await within(project.root, artifact));
          const digest = createHash('sha256').update(bytes).digest('hex');
          if (digest !== run.steps.find(item => item.id === step.id).observations[observation.name]) {
            reasons.push(`${side} screenshot ${key} artifact digest differs from the run`);
          }
        } catch (error) {
          reasons.push(`${side} screenshot ${key} artifact cannot be read: ${error.message}`);
        }
      }
    }
  }
  return reasons.length ? { ...comparison, status: 'unknown', reasons, differences: [] } : comparison;
}

export async function compareCase(projectDir, caseId, options = {}) {
  const project = await loadProject(projectDir);
  const comparison = await compareLoadedCase(project, caseId);
  if (options.save !== false) await writeJsonAtomic(join(project.root, 'reports', `${caseId}.json`), comparison);
  return comparison;
}

async function evidenceIssue(project, ref) {
  let path;
  try { path = await within(project.root, ref.file); }
  catch (error) { return error.message; }
  let record;
  try { record = await readJson(path); }
  catch (error) { return `Cannot read ${ref.file}: ${error.message}`; }
  const data = record?.data ?? record;
  if (data?.evidence_id !== ref.evidence_id) return `Evidence ID mismatch in ${ref.file}`;
  const expectedDigest = project.target.original.artifact_sha256;
  const actualDigest = data?.normalized_result?.root_artifact_sha256 ?? data?.subject?.digest;
  if (expectedDigest && actualDigest !== expectedDigest) return `Original artifact digest mismatch in ${ref.file}`;
  return null;
}

export async function report(projectDir) {
  const project = await loadProject(projectDir);
  const claims = [];
  const comparisonCache = new Map();
  const evidenceCache = new Map();
  for (const claim of project.target.claims) {
    const reasons = [];
    if (!claim.owner_path) reasons.push('missing implementation owner');
    if (!claim.evidence_refs.length) reasons.push('missing original Evidence reference');
    for (const ref of claim.evidence_refs) {
      const key = `${ref.file}\0${ref.evidence_id}`;
      if (!evidenceCache.has(key)) evidenceCache.set(key, await evidenceIssue(project, ref));
      const issue = evidenceCache.get(key);
      if (issue) reasons.push(issue);
    }
    const cases = [];
    for (const caseId of claim.case_ids) {
      if (!comparisonCache.has(caseId)) comparisonCache.set(caseId, await compareLoadedCase(project, caseId));
      const comparison = comparisonCache.get(caseId);
      cases.push({ id: caseId, status: comparison.status, differences: comparison.differences, reasons: comparison.reasons });
      if (comparison.status !== 'pass') reasons.push(`${caseId}: ${comparison.status}`);
    }
    const status = reasons.length ? (cases.some(item => item.status === 'changed') ? 'changed' : 'open') : 'checks-passed';
    claims.push({ id: claim.id, required: claim.required, status, reasons, cases });
  }
  const required = claims.filter(claim => claim.required);
  const status = required.some(claim => claim.status === 'changed') ? 'changed' : required.every(claim => claim.status === 'checks-passed') && required.length > 0 ? 'checks-passed' : 'open';
  return { schema: 'reconstruction-report/v1', project_id: project.target.id, status, evidence_validation: 'reference-only', claims };
}
