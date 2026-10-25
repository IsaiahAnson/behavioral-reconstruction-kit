#!/usr/bin/env node
import { capture, compareCase, report } from './kit.js';

const [command, project, caseId, side, ...flags] = process.argv.slice(2);

async function main() {
  if (!command || !project) {
    throw new Error('Usage: npm run kit -- <check|capture|compare> <project-dir> [case-id] [original|candidate]');
  }
  let result;
  switch (command) {
    case 'check': result = await report(project); break;
    case 'capture':
      if (!caseId || !side) throw new Error('capture needs a case ID and original|candidate');
      result = await capture(project, caseId, side, { trace: flags.includes('--trace') });
      break;
    case 'compare':
      if (!caseId) throw new Error('compare needs a case ID');
      result = await compareCase(project, caseId);
      break;
    default: throw new Error(`Unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'changed') process.exitCode = 2;
  if (result.status === 'open' || result.status === 'unknown') process.exitCode = 3;
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
