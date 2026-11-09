import fs from 'node:fs';
import path from 'node:path';
import { readLock, parseTasks, taskIdOf, tickedLines, requiredForTask } from './lock.js';
import { runContracts, contractName } from './contracts.js';
import { computeReceiptHash } from './receipts.js';

// Req 14: catch a tick however it got there. Nothing in this file writes a file, so
// `necro audit` can run in CI and on a fresh clone (Req 14.2). The Stop and PostTaskExec
// handlers in hooks.js use auditSpec to find the ticks to undo (Req 14.3).

export const OK = 'ok';
export const NO_RECEIPT = 'no receipt';
export const FAILING = 'failing';

// The names of the failing contracts among those that are required, sorted. `required`
// is a list of contract names. A contract file that holds a required contract and
// failed as a whole (it did not load, or the runner exited badly) counts as well, even
// when the required contract passed on its own (Req 4.17).
export function failingRequired(results, required) {
  const requiredPaths = new Set(results.filter((r) => required.includes(r.name)).map((r) => r.path));
  const failing = results.filter(
    (r) => r.result === 'fail' && (required.includes(r.name) || (requiredPaths.has(r.path) && r.name === contractName(r.path))),
  );
  // Req 14.10: a required contract with no result at all did not run, which is not a pass.
  const ran = new Set(results.map((r) => r.name));
  const missing = required.filter((n) => !ran.has(n));
  return [...new Set([...failing.map((r) => r.name), ...missing])].sort();
}

// What the gate's receipts of a spec say about its tasks: the task ids and the task
// lines they were written for. A receipt counts only when its file holds a receipt whose
// receiptHash is right for its content and which names this spec, so an edited or
// copied-in receipt is not evidence. A receipt with no task (necro check) is none.
function receiptEvidence(cwd, spec) {
  const ids = new Set();
  const lines = new Set();
  const dir = path.join(cwd, '.necro', 'receipts', spec);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return { ids, lines }; // no receipts
  }
  for (const f of files) {
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!receipt || typeof receipt !== 'object' || receipt.spec !== spec) continue;
    if (!receipt.task || typeof receipt.task.id !== 'string' || typeof receipt.task.line !== 'string') continue;
    if (computeReceiptHash(receipt) !== receipt.receiptHash) continue;
    for (const id of receipt.task.id.split(', ')) ids.add(id);
    for (const line of receipt.task.line.split('\n')) lines.add(line.trim());
  }
  return { ids, lines };
}

// The contract names the lock records for a spec, sorted.
export function lockedNames(entry) {
  const names = new Set();
  for (const c of (entry && entry.contracts) || []) for (const n of c.names || []) names.add(n);
  return [...names].sort();
}

// The ticked lines of a tasks.md that were not ticked when a person last froze the spec (Req 14.7).
// A line ticked at the freeze is matched by text, once per recorded occurrence, in file order,
// so a copy of such a line added later is new. Returns [{ index, text }].
function freshTicks(entry, markdown) {
  const credit = new Map();
  for (const text of Array.isArray(entry.ticked) ? entry.ticked : []) credit.set(text, (credit.get(text) || 0) + 1);
  const fresh = [];
  for (const t of tickedLines(markdown)) {
    if ((credit.get(t.text) || 0) > 0) credit.set(t.text, credit.get(t.text) - 1);
    else fresh.push(t);
  }
  return fresh;
}

// Req 14.7: the ticked tasks of a frozen spec that were not ticked when a person last froze it,
// and the contract files whose contracts those tasks require. A line ticked at the freeze is
// matched by text, once per recorded occurrence, in file order, so a copy of such a line added
// later is new. Which contracts a task requires is decided as in auditSpec. Reads files; runs
// nothing and writes nothing.
// Returns { fresh: [{ index, text }], names, paths }. `paths` is a Set of contract file paths,
// or null when every contract file is needed (a task that requires every contract).
export function planAudit(cwd, spec, lock = readLock(cwd)) {
  const entry = lock.specs && lock.specs[spec];
  const names = lockedNames(entry);
  const none = { fresh: [], names, paths: new Set() };
  if (!entry) return none;
  let markdown = '';
  try {
    markdown = fs.readFileSync(path.join(cwd, '.kiro', 'specs', spec, 'tasks.md'), 'utf8');
  } catch {
    return none;
  }
  const fresh = freshTicks(entry, markdown);
  const table = entry.tasks || {};
  const lines = parseTasks(markdown);
  const required = new Set();
  for (const { text } of fresh) {
    const id = taskIdOf(text);
    const matching = id !== null ? requiredForTask(table, lines, text, names) : null;
    if (matching === null) return { fresh, names, paths: null };
    for (const n of matching) required.add(n);
  }
  const paths = new Set();
  for (const c of entry.contracts || []) if ((c.names || []).some((n) => required.has(n))) paths.add(c.path);
  return { fresh, names, paths };
}

// Audit one frozen spec: every ticked task line of its tasks.md with one verdict (Req 14.1).
//   ok          every contract the task requires passes now, and either the gate wrote a
//               receipt for the task id (under any freeze of the spec) or the task was
//               already ticked when a person last froze the spec
//   failing     a contract the task requires fails now (names listed)
//   no receipt  the required contracts pass but nothing shows the gate accepted the tick
// Which contracts a task requires is decided as for the gate (Req 4.14, 4.15, 4.16),
// except that being the last unticked task adds nothing here.
// `results` are the spec's contract results, run now unless the caller has them.
// With `onlyNew` (Req 14.7) only the tasks ticked since the last freeze are audited, and when
// the contracts are run here, only the contract files those tasks require.
// Returns { spec, tasks: [{ index, id, text, verdict, failing }] }, `index` being the
// 0-based line of tasks.md. Runs the contracts and reads files; writes nothing.
export function auditSpec(cwd, spec, lock = readLock(cwd), results = null, { onlyNew = false } = {}) {
  const entry = lock.specs && lock.specs[spec];
  if (!entry) return { spec, tasks: [] };
  let markdown = '';
  try {
    markdown = fs.readFileSync(path.join(cwd, '.kiro', 'specs', spec, 'tasks.md'), 'utf8');
  } catch {
    return { spec, tasks: [] };
  }
  // Req 14.10: with results from the caller (the Stop handler planned and ran them), nothing is
  // planned again here: the tasks ticked now are audited against those results, and a task that
  // needs a contract the results do not hold fails. Without results the plan decides what to run.
  const plan = onlyNew && results === null ? planAudit(cwd, spec, lock) : null;
  const ticked = onlyNew ? (plan ? plan.fresh : freshTicks(entry, markdown)) : tickedLines(markdown);
  if (ticked.length === 0) return { spec, tasks: [] };

  const ran = results || runContracts(cwd, spec, lock, plan ? plan.paths : null);
  // A partial run knows only some names; the lock knows them all. A name the lock records and
  // the results lack is still a name, so a contract that did not run can be required (Req 14.10).
  const names = [...new Set([...lockedNames(entry), ...ran.map((r) => r.name)])].sort();
  const table = entry.tasks || {};
  const lines = parseTasks(markdown);
  const idCount = new Map();
  for (const l of lines) idCount.set(l.id, (idCount.get(l.id) || 0) + 1);
  const evidence = receiptEvidence(cwd, spec);

  // The task lines that were ticked when the spec was last frozen, counted per text, so a
  // copy of such a line added later gets no credit. (Not used with onlyNew, which has left
  // the credited lines out already.)
  const credit = new Map();
  for (const text of Array.isArray(entry.ticked) ? entry.ticked : []) credit.set(text, (credit.get(text) || 0) + 1);

  const tasks = [];
  for (const { index, text } of ticked) {
    const id = taskIdOf(text);
    const required = (id !== null && requiredForTask(table, lines, text, names)) || names;
    let failing = failingRequired(ran, required);
    if (ran.length === 0) failing = ['no contracts ran'];

    // A receipt names a task id. An id that is on more than one line names no single
    // line, so the line text has to be one the receipt was written for.
    const receipted = id !== null && evidence.ids.has(id) && (idCount.get(id) === 1 || evidence.lines.has(text));
    let accepted = receipted;
    if (!accepted && !onlyNew && (credit.get(text) || 0) > 0) {
      credit.set(text, credit.get(text) - 1);
      accepted = true;
    }

    const verdict = failing.length > 0 ? FAILING : accepted ? OK : NO_RECEIPT;
    tasks.push({ index, id, text, verdict, failing: verdict === FAILING ? failing : [] });
  }
  return { spec, tasks };
}

// The tasks of an audit that are not ok, with the reason in a plain sentence.
export function problems(audit) {
  return audit.tasks
    .filter((t) => t.verdict !== OK)
    .map((t) => ({
      ...t,
      reason:
        t.verdict === FAILING
          ? `required contracts fail now: ${t.failing.join(', ')}`
          : 'no receipt shows the gate accepted it',
    }));
}

// `necro audit [spec]`: list every ticked task of each frozen spec (or of one) with its
// verdict. Exit 0 only if every ticked task is ok (Req 14.1). Changes no file (Req 14.2).
// Returns { exitCode, stdout, stderr }.
export function runAudit(cwd, specName) {
  const lock = readLock(cwd);
  const frozen = Object.keys(lock.specs || {}).sort();
  if (specName !== undefined && !Object.hasOwn(lock.specs || {}, specName)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Spec '${specName}' is not frozen. Ask a person to review its contracts and freeze it first.`,
    };
  }
  const specs = specName === undefined ? frozen : [specName];
  if (specs.length === 0) return { exitCode: 0, stdout: 'No frozen specs, so no ticked tasks to audit.', stderr: '' };

  const out = [];
  let notOk = 0;
  for (const spec of specs) {
    const audit = auditSpec(cwd, spec, lock);
    const okCount = audit.tasks.filter((t) => t.verdict === OK).length;
    out.push(
      audit.tasks.length === 0
        ? `Spec ${spec}: no ticked tasks.`
        : `Spec ${spec}: ${audit.tasks.length} ticked tasks, ${okCount} ok.`,
    );
    for (const t of audit.tasks) {
      const detail = t.verdict === FAILING ? ` (failing: ${t.failing.join(', ')})` : '';
      out.push(`  ${t.verdict.padEnd(10)}  ${t.text}${detail}`);
    }
    notOk += audit.tasks.length - okCount;
  }
  if (notOk > 0) {
    out.push(
      `${notOk} ticked ${notOk === 1 ? 'task is' : 'tasks are'} not ok. Fix the code and tick the task again through the gate, or ask a person to review and freeze the spec.`,
    );
  }
  return { exitCode: notOk === 0 ? 0 : 1, stdout: out.join('\n'), stderr: '' };
}
