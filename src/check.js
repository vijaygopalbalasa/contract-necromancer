import { readLock } from './lock.js';
import { runContracts } from './contracts.js';
import { buildReceipt, writeReceipt } from './receipts.js';

// Run every frozen contract of a frozen spec and write a receipt with task null and
// every contract required (Req 9.1). Never touches tasks.md (Req 9.4). Returns
// { frozen: false } for a spec that is not frozen (Req 9.3), otherwise
// { frozen: true, results, receipt }: `results` is one { name, path, sha256, result }
// per contract and `receipt` the project-relative path of the receipt written, which
// happens whether or not every contract passes (Req 9.2). Prints nothing, so the MCP
// server (Req 10.2) can call it.
export function runCheck(cwd, spec) {
  const lock = readLock(cwd);
  if (!lock.specs || !Object.hasOwn(lock.specs, spec)) return { frozen: false };
  const results = runContracts(cwd, spec, lock);
  const receipt = writeReceipt(cwd, spec, buildReceipt(cwd, spec, lock, results, { task: null }));
  return { frozen: true, results, receipt };
}

// `necro check <spec>`: run every frozen contract of a frozen spec, print each
// result by name, and write a receipt (Req 9.1). Returns { exitCode, stdout,
// stderr }: 0 when every contract passes, 1 when any fails (the receipt is still
// written, Req 9.2) or the spec is not frozen (Req 9.3).
export function checkSpec(cwd, spec) {
  const checked = runCheck(cwd, spec);
  if (!checked.frozen) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Spec '${spec}' is not frozen. Run 'necro freeze ${spec}' first.`,
    };
  }

  const { results, receipt: receiptPath } = checked;
  const lines = results.map((r) => `${r.result} ${r.name}`);
  const failing = results.filter((r) => r.result !== 'pass');

  if (results.length === 0 || failing.length > 0) {
    // Req 13.4: a contract file that could not run says why, naming the file.
    for (const reason of new Set(failing.filter((r) => r.reason).map((r) => r.reason))) lines.push(reason);
    // Req 16.4: when every failure is a program that could not start or a module that is missing, the work was not
    // checked, so the message says the contracts cannot run here and does not tell the person to fix the code.
    const missing = [...new Set(failing.filter((r) => r.cannotRun).map((r) => r.cannotRun))];
    if (failing.length > 0 && failing.every((r) => r.cannotRun)) {
      lines.push(`The contracts cannot run here: ${missing.join('; ')}. Install or fix it, then run 'necro check ${spec}' again.`);
    } else {
      lines.push(
        results.length === 0
          ? 'No contracts ran. Check the contract files in the spec.'
          : `${failing.length} of ${results.length} contracts failed. Fix the code, then run 'necro check ${spec}' again.`,
      );
    }
    lines.push(`Receipt: ${receiptPath}`);
    return { exitCode: 1, stdout: lines.join('\n'), stderr: '' };
  }
  lines.push(`All ${results.length} contracts pass.`);
  lines.push(`Receipt: ${receiptPath}`);
  return { exitCode: 0, stdout: lines.join('\n'), stderr: '' };
}
