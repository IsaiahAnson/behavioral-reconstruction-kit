import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCase, capture, report } from '../src/kit.js';
import { startDemoServer } from '../fixtures/demo-app.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = join(repoRoot, 'examples', 'demo');
const caseId = 'add-and-reload';
const servers = [];
let tempDir;

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose());
  });
}

try {
  const original = await startDemoServer();
  servers.push(original);
  const candidate = await startDemoServer();
  servers.push(candidate);

  tempDir = await mkdtemp(join(tmpdir(), 'rea-demo-'));
  const projectDir = join(tempDir, 'project');
  await cp(exampleDir, projectDir, { recursive: true });

  const targetPath = join(projectDir, 'target.json');
  const target = JSON.parse(await readFile(targetPath, 'utf8'));
  target.original.base_url = original.baseUrl;
  target.candidate.base_url = candidate.baseUrl;
  await writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`, 'utf8');

  await capture(projectDir, caseId, 'original');
  await capture(projectDir, caseId, 'candidate');
  const comparison = await compareCase(projectDir, caseId);
  if (comparison.status !== 'pass') {
    throw new Error(`Demo comparison failed: ${comparison.status}`);
  }

  const coverage = await report(projectDir);
  if (coverage.status !== 'open' || !coverage.claims.some(claim =>
    claim.reasons.includes('missing original Evidence reference')
  )) {
    throw new Error(`Demo report did not have the expected open Evidence state: ${coverage.status}`);
  }

  process.stdout.write(`PASS ${caseId}: original and candidate match\n`);
  process.stdout.write('Report: open (expected: demo claim has no Evidence reference)\n');
} finally {
  try {
    const results = await Promise.allSettled(servers.map(({ server }) => closeServer(server)));
    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Failed to close demo servers');
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}
