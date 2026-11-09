import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASK_LINE } from './lock.js';

// `necro demo` (Req 11): copy the bundled Pumpkin Ledger example into a new folder
// under the temporary directory, plant a rounding bug, let the gate refuse the tick
// of task 4, restore the code, let the gate accept it, and verify the receipt.
// Every step runs in the copy. The gate and `verify` run through the same
// `bin/necro.js` the user started, with the payload the Kiro IDE sends.

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(ROOT, 'bin', 'necro.js');
const EXAMPLE = path.join(ROOT, 'examples', 'pumpkin-ledger');

const SPEC = 'ledger';
const TASKS_REL = '.kiro/specs/ledger/tasks.md';
const SPLIT_REL = 'src/split.js';
const TASK_ID = '4';
const CHILD_TIMEOUT_MS = 240_000;

// The steps, in order. A failed run names one of them (Req 11.5).
export const STEPS = ['setup', 'refusal', 'acceptance', 'confirmed', 'mismatch'];

class StepFailed extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

// The test runner sets NODE_TEST_* variables. A child process must not see them.
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(folder, args, input) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: folder,
    input,
    encoding: 'utf8',
    env: childEnv(),
    timeout: CHILD_TIMEOUT_MS,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// The `task_update` call the Kiro IDE sends when a task completes, as the PreToolUse
// hook receives it. `taskId` is the task line text after the checkbox.
function taskUpdateCall(taskLine) {
  return JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: 'task_update',
    tool_input: { tasksFilePath: TASKS_REL, taskId: taskLine, status: 'completed' },
  });
}

// The failing contracts in a gate refusal, "Contracts failed: <name>, <name>.", or null when the text holds none. A name
// may hold ", ", so the list is split only where the next name starts with a contract ID such as R2.1. The ID is the
// first word of a name.
export function parseFailing(stderr) {
  const m = /^Contracts failed: (.+)\.$/m.exec(stderr);
  if (!m) return null;
  const names = m[1].split(/, (?=R\d+\.\d+ )/);
  return { ids: names.map((n) => n.split(' ')[0]), names };
}

// Replace text in a file of the copy; fails the step when the text is not there.
function replaceInFile(file, pairs, step) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new StepFailed(step, `Expected text not found in ${path.basename(file)}: ${from}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(file, text);
}

// Reopen task 4 in the copy and return its line text after the checkbox.
function reopenTask(folder) {
  const file = path.join(folder, TASKS_REL);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = TASK_LINE.exec(lines[i]);
    if (m && m[2].startsWith(`${TASK_ID}. `)) {
      lines[i] = lines[i].replace(/\[[xX]\]/, '[ ]');
      fs.writeFileSync(file, lines.join('\n'));
      return m[2].trim();
    }
  }
  throw new StepFailed('setup', `Task ${TASK_ID} was not found in the example's tasks.md.`);
}

// The receipt the gate wrote for the task after `since` (milliseconds).
function newReceipt(folder, since) {
  const dir = path.join(folder, '.necro', 'receipts', SPEC);
  let found = null;
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const at = Date.parse(receipt.createdAt);
    if (receipt.task && receipt.task.id === TASK_ID && at >= since && (!found || at > found.at)) found = { file, at };
  }
  return found && found.file;
}

// Run the demo. Options exist so tests can make a step go wrong:
//   out, err   functions that print a line (default console.log, console.error)
//   plant      (folder) => void, replaces the step that plants the bug
//   restore    (folder) => void, replaces the step that restores the correct code
// Returns { exitCode, failedStep, folder }; failedStep is null when every step
// happened as described (Req 11.5).
export function runDemo(options = {}) {
  const out = options.out || ((s) => console.log(s));
  const err = options.err || ((s) => console.error(s));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-demo-'));
  let step = 'setup';
  try {
    // Req 11.1: work in a copy under the temporary directory.
    out(`Demo folder: ${folder}`);
    out('Pumpkin Ledger is copied there. Nothing outside that folder changes.');
    fs.cpSync(EXAMPLE, folder, { recursive: true });
    const split = path.join(folder, SPLIT_REL);
    const original = fs.readFileSync(split, 'utf8');
    const taskLine = reopenTask(folder);

    // Req 11.2: plant the rounding bug and send the tick.
    out('');
    out(`Step 1. Reopen task ${TASK_ID} and plant a bug in ${SPLIT_REL}: round each share, so cents are lost.`);
    (options.plant || ((dir) => replaceInFile(path.join(dir, SPLIT_REL), [
      ['Math.floor(cents / n)', 'Math.round(cents / n)'],
      ['const extra = cents % n;', 'const extra = 0;'],
    ], 'setup')))(folder);
    out(`Step 2. Send the gate what the Kiro IDE sends when task ${TASK_ID} completes (task_update, status completed).`);
    step = 'refusal';
    const refused = necro(folder, ['hook', 'pre'], taskUpdateCall(taskLine));
    if (refused.error) throw new StepFailed(step, `The gate did not run: ${refused.error.message}`);
    const failed = parseFailing(refused.stderr);
    if (refused.status !== 2 || !failed) {
      throw new StepFailed(step, `The gate should have refused the tick (exit 2 with failing contracts) but exited ${refused.status}. ${refused.stderr.trim()}`.trim());
    }
    out(`The gate refused the tick (exit ${refused.status}).`);
    // One line a reader takes in at a glance: the IDs. The full names follow, one per line.
    out(`Contracts failed: ${failed.ids.join(', ')}`);
    for (const name of failed.names) out(`  ${name}`);

    // Req 11.3: restore the correct code and send the same call again.
    out('');
    out(`Step 3. Restore the correct ${SPLIT_REL} and send the same call again.`);
    (options.restore || (() => fs.writeFileSync(split, original)))(folder);
    step = 'acceptance';
    const since = Date.now();
    const accepted = necro(folder, ['hook', 'pre'], taskUpdateCall(taskLine));
    if (accepted.error) throw new StepFailed(step, `The gate did not run: ${accepted.error.message}`);
    if (accepted.status !== 0) {
      throw new StepFailed(step, `The gate should have accepted the tick (exit 0) but exited ${accepted.status}. ${accepted.stderr.trim()}`.trim());
    }
    const receipt = newReceipt(folder, since);
    if (!receipt) throw new StepFailed(step, 'The gate accepted the tick but wrote no receipt.');
    out(`The gate accepted the tick (exit ${accepted.status}).`);
    out(`Receipt: ${receipt}`);

    // Req 11.4: verify the receipt, change the code, verify again.
    out('');
    out('Step 4. Re-run the receipt with necro verify.');
    step = 'confirmed';
    const confirmed = necro(folder, ['verify', receipt]);
    if (confirmed.status !== 0 || !/^CONFIRMED /m.test(confirmed.stdout)) {
      throw new StepFailed(step, `necro verify should print CONFIRMED and exit 0 but exited ${confirmed.status}. ${(confirmed.stdout + confirmed.stderr).trim()}`.trim());
    }
    out(confirmed.stdout.trim());
    out(`Step 5. Change ${SPLIT_REL} in the copy and verify the same receipt again.`);
    fs.appendFileSync(split, '// edited by the demo\n');
    step = 'mismatch';
    const mismatch = necro(folder, ['verify', receipt]);
    if (mismatch.status !== 1 || !/^MISMATCH/m.test(mismatch.stdout)) {
      throw new StepFailed(step, `necro verify should print MISMATCH and exit 1 but exited ${mismatch.status}. ${(mismatch.stdout + mismatch.stderr).trim()}`.trim());
    }
    out(mismatch.stdout.trim());

    out('');
    out('The gate refused the false "done", accepted the real fix, and the receipt caught the later change.');
    out(`The copy stays at ${folder}. Delete it when you are done.`);
    return { exitCode: 0, failedStep: null, folder };
  } catch (e) {
    const failedStep = e instanceof StepFailed ? e.step : step;
    err(`Demo failed at step '${failedStep}' (${STEPS.indexOf(failedStep) + 1} of ${STEPS.length}): ${e.message}`);
    return { exitCode: 1, failedStep, folder };
  }
}
