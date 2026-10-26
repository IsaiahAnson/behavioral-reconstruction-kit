import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareCase, loadProject, report } from './kit.js';

const REA_VERSION = '6.7.0';

function addTask(tasks, priority, kind, subject, detail, next) {
  tasks.push({ priority, kind, subject, detail, next });
}

function firstDifference(comparison) {
  const item = comparison.differences[0];
  return item && `${item.step_id}/${item.observation}: original ${JSON.stringify(item.original)}, candidate ${JSON.stringify(item.candidate)}`;
}

export function planTriage(project, reportResult, comparisons, rea = null) {
  const tasks = [];
  for (const [caseId, comparison] of comparisons) {
    if (comparison.status === 'changed') {
      addTask(tasks, 1, 'debug-difference', caseId, firstDifference(comparison), `Inspect the candidate at step ${comparison.differences[0].step_id}, fix its behavior, then capture candidate and compare ${caseId} again.`);
    } else if (comparison.status === 'unknown') {
      addTask(tasks, 2, 'refresh-captures', caseId, comparison.reasons.join('; '), `Capture original and candidate for ${caseId}, then compare again.`);
    }
  }
  for (const claim of project.target.claims) {
    const finding = reportResult.claims.find(item => item.id === claim.id);
    for (const reason of finding.reasons) {
      if (claim.case_ids.some(id => reason === `${id}: changed` || reason === `${id}: unknown`)) continue;
      if (reason === 'missing original Evidence reference') {
        addTask(tasks, 2, 'collect-evidence', claim.id, reason, 'Use REA to investigate the original behavior; save the full Evidence record and attach its file and ID to this claim.');
      } else if (reason === 'missing implementation owner') {
        addTask(tasks, 3, 'assign-owner', claim.id, reason, 'Set owner_path to the candidate implementation responsible for this claim.');
      } else {
        addTask(tasks, 2, 'repair-evidence', claim.id, reason, 'Correct the Evidence reference or recapture the original with REA.');
      }
    }
  }
  if (rea) {
    if (rea.status !== 'ready') {
      for (const reason of rea.reasons) addTask(tasks, 1, 'rea-coverage', reason.subject_id, `${reason.code}: ${reason.detail}`, 'Follow the REA recommended probes, then evaluate coverage again.');
      for (const probe of rea.recommended_probes) addTask(tasks, 2, 'rea-probe', probe.subject_id, `${probe.operation}: ${probe.rationale}`, 'Follow this REA recommendation and retain any resulting Evidence.');
      if (!rea.reasons.length && !rea.recommended_probes.length) addTask(tasks, 1, 'rea-coverage', rea.boundary_id, `REA status: ${rea.status}`, 'Inspect the REA coverage result.');
    }
  }
  tasks.sort((a, b) => a.priority - b.priority || a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind));
  const status = rea?.status === 'failed' || reportResult.status === 'changed' ? 'changed'
    : (rea && rea.status !== 'ready') || reportResult.status !== 'checks-passed' ? 'open' : 'checks-passed';
  return { schema: 'reconstruction-triage/v1', project_id: project.target.id, status, local_status: reportResult.status, rea_coverage: rea, tasks };
}

function runReaCli(cwd) {
  return new Promise((resolveResult, reject) => {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
    const args = process.platform === 'win32'
      ? ['/d', '/c', 'npx', '-y', `rea-agents@${REA_VERSION}`, 'evaluate-reconstruction-coverage', 'input.json', '--format', 'json']
      : ['-y', `rea-agents@${REA_VERSION}`, 'evaluate-reconstruction-coverage', 'input.json', '--format', 'json'];
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2000000) child.kill(); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 2000000) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`REA coverage failed: ${(stderr || stdout).trim().slice(0, 1000) || `exit ${code}`}`));
      try { resolveResult(JSON.parse(stdout)); }
      catch { reject(new Error('REA coverage returned invalid JSON')); }
    });
  });
}

export async function evaluateReaCoverage(inputPath) {
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  const temp = await mkdtemp(join(tmpdir(), 'brk-rea-coverage-'));
  try {
    await writeFile(join(temp, 'input.json'), JSON.stringify(input));
    const output = await runReaCli(temp);
    const result = output.data ?? output;
    if (!['ready', 'partial', 'failed', 'unknown'].includes(result.status)) throw new Error(`REA coverage returned an unrecognized status: ${JSON.stringify(result.status)}`);
    return {
      provider: `rea-agents@${REA_VERSION}`,
      boundary_id: input.boundary_id,
      status: result.status,
      reasons: Array.isArray(result.reasons) ? result.reasons : [],
      recommended_probes: Array.isArray(result.recommended_probes) ? result.recommended_probes : [],
      evidence_ids: Array.isArray(result.evidence_ids) ? result.evidence_ids : []
    };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function triage(projectDir, options = {}) {
  const project = await loadProject(projectDir);
  const [reportResult, comparisons, rea] = await Promise.all([
    report(projectDir),
    Promise.all([...project.cases.keys()].map(async id => [id, await compareCase(projectDir, id, { save: false })])),
    options.reaCoverage ? evaluateReaCoverage(options.reaCoverage) : null
  ]);
  return planTriage(project, reportResult, comparisons, rea);
}
