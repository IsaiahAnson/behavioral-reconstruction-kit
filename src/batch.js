import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { capture, compareCase, loadProject } from './kit.js';

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function markFailedCapture(project, caseId, side, message) {
  const runPath = join(project.root, 'runs', `${caseId}.${side}.json`);
  const historyDir = join(project.root, 'runs', 'history');
  await mkdir(historyDir, { recursive: true });
  try {
    await rename(runPath, join(historyDir, `${caseId}.${side}.${randomUUID()}.json`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeJsonAtomic(runPath, {
    schema: 'reconstruction-run-failure/v1',
    project_id: project.target.id,
    case_id: caseId,
    side,
    failed_at: new Date().toISOString(),
    error: message
  });
}

export async function runAll(projectDir, options = {}) {
  const project = await loadProject(projectDir);
  const cases = [];

  for (const caseId of project.cases.keys()) {
    const captures = {};
    const captureErrors = [];
    for (const side of ['original', 'candidate']) {
      try {
        await capture(projectDir, caseId, side, options);
        captures[side] = { status: 'captured' };
      } catch (error) {
        const message = errorMessage(error);
        await markFailedCapture(project, caseId, side, message);
        captures[side] = { status: 'failed', error: message };
        captureErrors.push(`${side} capture failed: ${message}`);
      }
    }

    let comparison;
    let saveSyntheticReport = captureErrors.length > 0;
    if (captureErrors.length) {
      comparison = {
        schema: 'reconstruction-comparison/v1',
        case_id: caseId,
        status: 'unknown',
        reasons: captureErrors,
        differences: []
      };
    } else {
      try {
        comparison = await compareCase(projectDir, caseId);
      } catch (error) {
        saveSyntheticReport = true;
        comparison = {
          schema: 'reconstruction-comparison/v1',
          case_id: caseId,
          status: 'unknown',
          reasons: [`Comparison failed: ${errorMessage(error)}`],
          differences: []
        };
      }
    }

    if (saveSyntheticReport) {
      await writeJsonAtomic(join(project.root, 'reports', `${caseId}.json`), comparison);
    }
    cases.push({
      case_id: caseId,
      captures,
      comparison: {
        status: comparison.status,
        reasons: comparison.reasons,
        differences: comparison.differences
      }
    });
  }

  const totals = { pass: 0, changed: 0, unknown: 0 };
  for (const item of cases) totals[item.comparison.status]++;
  const status = cases.length === 0 || totals.unknown ? 'unknown' : totals.changed ? 'changed' : 'pass';
  return { schema: 'reconstruction-batch/v1', project_id: project.target.id, status, totals, cases,
    reasons: cases.length === 0 ? ['No case files were found'] : [] };
}
