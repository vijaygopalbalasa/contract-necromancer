import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './canon.js';
import { readLock, isSpecFrozen, frozenFiles } from './lock.js';
import { runContracts } from './contracts.js';
import { buildReceipt, writeReceipt } from './receipts.js';

const ALLOW = Object.freeze({ exitCode: 0, stdout: '', stderr: '' });

// Req 3.6: only these tools are known to be read-only. Any other tool is treated
// as a write when one of its input fields names a protected path.
const READ_ONLY_TOOLS = new Set(['read_file', 'list_directory', 'grep', 'glob']);

// For the two write tools whose shape is known, these fields hold file content,
// not paths. For every other tool all fields are checked.
const CONTENT_FIELDS = new Set(['text', 'oldStr', 'newStr']);

// Normalize a path to forward slashes.
function toRel(p) {
  return p.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Path resolution (Req 3.5)
// ---------------------------------------------------------------------------

// Resolve an absolute path to its real path the way the operating system would:
// follow every symbolic link (also a link in the middle of the path, and a link
// whose target does not exist yet) and apply ".." after following links. The part
// of the path that does not exist yet is kept as written. Returns null when
// links loop.
function resolveReal(start) {
  const root = path.parse(start).root;
  let queue = start.slice(root.length).split(path.sep).filter((s) => s !== '' && s !== '.');
  let cur = root;
  let hops = 0;
  while (queue.length > 0) {
    const seg = queue.shift();
    if (seg === '..') {
      cur = path.dirname(cur);
      continue;
    }
    const next = path.join(cur, seg);
    let stat = null;
    try {
      stat = fs.lstatSync(next);
    } catch {
      cur = next; // does not exist yet
      continue;
    }
    if (!stat.isSymbolicLink()) {
      cur = next;
      continue;
    }
    if (++hops > 40) return null;
    let target;
    try {
      target = fs.readlinkSync(next);
    } catch {
      cur = next;
      continue;
    }
    if (path.isAbsolute(target)) cur = path.parse(target).root;
    queue = target.split(path.sep).filter((s) => s !== '' && s !== '.').concat(queue);
  }
  return cur;
}

// Case and Unicode normal form are ignored when comparing paths, because the
// file system may ignore them (macOS, Windows).
function compareKey(rel) {
  return rel.normalize('NFC').toLowerCase();
}

// Returns a function that maps a tool-supplied path (absolute, or relative to
// cwd) to { rel, key }: the real project-relative path with forward slashes, and
// its comparison key. Returns null for a path outside the project root.
function projectResolver(cwd) {
  const absCwd = path.resolve(cwd);
  const root = resolveReal(absCwd) || absCwd;
  return (p) => {
    const abs = path.isAbsolute(p) ? p : `${absCwd}${path.sep}${p}`;
    const real = resolveReal(abs);
    if (real === null) return null;
    const rel = path.relative(root, real);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    const fwd = toRel(rel);
    return { rel: fwd, key: compareKey(fwd) };
  };
}

// Every string found anywhere in a tool's input that could name a path.
function* pathCandidates(value, skipFields) {
  if (typeof value === 'string') {
    if (value.length > 0 && value.length <= 4096 && !value.includes('\0')) yield value;
  } else if (Array.isArray(value)) {
    for (const v of value) yield* pathCandidates(v);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (skipFields && skipFields.has(k)) continue;
      yield* pathCandidates(v);
    }
  }
}

// Map of comparison key -> lock path for every frozen file, by its lock path and
// by its real path (in case the frozen file is itself a symbolic link).
function frozenKeys(cwd, resolve) {
  const lock = readLock(cwd);
  const keys = new Map();
  for (const spec of Object.keys(lock.specs || {})) {
    const entry = lock.specs[spec];
    const paths = [];
    if (entry.requirements) paths.push(entry.requirements.path);
    for (const c of entry.contracts || []) paths.push(c.path);
    for (const p of paths) {
      keys.set(compareKey(p), p);
      const real = resolve(p);
      if (real && !keys.has(real.key)) keys.set(real.key, p);
    }
  }
  return keys;
}

// Req 3.2, 3.5, 3.6: find the first input field of a tool call that names a
// protected path (anything under .necro/, or a frozen file).
// Returns { kind: 'necro' } | { kind: 'frozen', path } | null.
function findProtected(cwd, toolName, toolInput) {
  const resolve = projectResolver(cwd);
  const frozen = frozenKeys(cwd, resolve);
  const knownWriteTool = toolName === 'fs_write' || toolName === 'str_replace';
  for (const candidate of pathCandidates(toolInput, knownWriteTool ? CONTENT_FIELDS : null)) {
    const hit = resolve(candidate);
    if (!hit) continue;
    if (hit.key === '.necro' || hit.key.startsWith('.necro/')) return { kind: 'necro' };
    if (frozen.has(hit.key)) return { kind: 'frozen', path: frozen.get(hit.key) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detecting a task being marked done (Req 4.1, 4.2)
// ---------------------------------------------------------------------------

// Count [x] task-done marks (case-insensitive) in a string.
export function countTaskMarks(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const matches = text.match(/\[x\]/gi);
  return matches ? matches.length : 0;
}

// A task line: an optional list marker, then a checkbox. The marker is optional
// so a box written without one still counts (Req 4.13).
const TASK_LINE = /^\s*(?:(?:[-*+]|\d+[.)])\s*)?\[([ xX])\]\s?(.*)$/;

// Multiset of task lines: "<checked or not>\0<task text>" -> how many.
function taskLines(text) {
  const counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const key = `${m[1] === ' ' ? ' ' : 'x'}\0${m[2].trim()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Number of ticked task lines in a text.
function tickedCount(text) {
  let n = 0;
  for (const [key, count] of taskLines(text)) if (key.startsWith('x\0')) n += count;
  return n;
}

// True when `after` has a ticked task line that `before` does not have, which
// covers a plain [ ] -> [x] change, a tick together with a rename, and one task
// unticked while another is ticked. It is also true when `after` has more ticked
// task lines than `before` even if no line can be matched to an earlier unticked
// one (a new file, a new ticked line) (Req 4.13).
export function newlyTicked(before, after) {
  if (tickedCount(after) > tickedCount(before)) return true;
  const was = taskLines(before);
  for (const [key, n] of taskLines(after)) {
    if (key.startsWith('x\0') && n > (was.get(key) || 0)) return true;
  }
  return false;
}

// The text with every ticked task line unticked.
function untick(text) {
  return text.replace(/^(\s*(?:(?:[-*+]|\d+[.)])\s*)?)\[[xX]\]/gm, '$1[ ]');
}

// Replace the first match (or every match) of oldStr in text, without treating
// "$" in newStr specially. Returns null when oldStr is not found.
function applyReplace(text, oldStr, newStr, all) {
  if (oldStr === '' || !text.includes(oldStr)) return null;
  if (all) return text.split(oldStr).join(newStr);
  const i = text.indexOf(oldStr);
  return text.slice(0, i) + newStr + text.slice(i + oldStr.length);
}

const TASKS_PATH = /^\.kiro\/specs\/([^/]+)\/tasks\.md$/i;

// Spec name as written in the lock when it differs from the path only in case.
function canonicalSpec(cwd, name) {
  const specs = Object.keys(readLock(cwd).specs || {});
  return specs.find((s) => s.toLowerCase() === name.toLowerCase()) || name;
}

// Describe an fs_write or str_replace on a spec's tasks.md, or null for any other
// call: { spec, before, after, exact }. A str_replace is applied to the file on
// disk (Req 4.1); an fs_write is compared with the file on disk (Req 4.2). When
// a str_replace does not apply to the file, the edit text itself is compared
// (exact is false), counting [x] marks anywhere in it, so the check errs
// towards treating it as a tick (Req 4.13).
function taskEdit(cwd, toolName, toolInput) {
  const p = toolInput && toolInput.path;
  if (typeof p !== 'string') return null;
  const hit = projectResolver(cwd)(p);
  if (!hit) return null;
  const m = TASKS_PATH.exec(hit.rel);
  if (!m) return null;
  const spec = canonicalSpec(cwd, m[1]);

  let disk = '';
  try {
    disk = fs.readFileSync(path.resolve(cwd, p), 'utf8');
  } catch {
    disk = ''; // the file does not exist yet
  }

  if (toolName === 'fs_write') {
    if (typeof toolInput.text !== 'string') return null;
    return { spec, before: disk, after: toolInput.text, exact: true };
  }
  if (toolName === 'str_replace') {
    const { oldStr, newStr } = toolInput;
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') return null;
    const all = toolInput.replace_all === true || toolInput.replaceAll === true;
    let after = applyReplace(disk, oldStr, newStr, all);
    if (after === null) {
      const lf = (s) => s.replace(/\r\n/g, '\n');
      after = applyReplace(lf(disk), lf(oldStr), lf(newStr), all);
      if (after !== null) return { spec, before: lf(disk), after, exact: true };
      // One ticked task line per [x] found, so only the count is compared.
      const marks = (t) => Array(countTaskMarks(t)).fill('- [x] mark').join('\n');
      return { spec, before: marks(oldStr), after: marks(newStr), exact: false };
    }
    return { spec, before: disk, after, exact: true };
  }
  return null;
}

// Detect whether a tool call on tasks.md is marking a task done (Req 4.1, 4.2).
export function detectTaskDone(cwd, toolName, toolInput) {
  const edit = taskEdit(cwd, toolName, toolInput);
  return edit !== null && newlyTicked(edit.before, edit.after);
}

// ---------------------------------------------------------------------------
// Recorded tasks.md state (Req 3.7)
//
// The gate records each frozen spec's tasks.md every time it lets a change
// through. PostToolUse compares a shell command's result with that record.
// ---------------------------------------------------------------------------

function tasksFile(cwd, spec) {
  return path.join(cwd, '.kiro', 'specs', spec, 'tasks.md');
}

function stateFile(cwd, spec) {
  return path.join(cwd, '.necro', 'state', `${encodeURIComponent(spec)}.tasks.md`);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function recordState(cwd, spec, text) {
  const file = stateFile(cwd, spec);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// ---------------------------------------------------------------------------
// PreToolUse
// ---------------------------------------------------------------------------

// PreToolUse: block edits to frozen files (Req 3) and gate marking a task done
// on the frozen contracts passing (Req 4).
//
// Returns { exitCode, stdout, stderr }. Exit 2 blocks the tool call and shows
// stderr to the agent; exit 0 allows it silently.
export function handlePreToolUse(payload) {
  const cwd = payload.cwd;
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input;
  if (!cwd || READ_ONLY_TOOLS.has(toolName)) return ALLOW;

  // Req 3.1, 3.2, 3.5, 3.6: a tool that is not known to be read-only is blocked
  // when any input field names .necro/ or a frozen file.
  const hit = findProtected(cwd, toolName, toolInput);
  if (hit && hit.kind === 'necro') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'Cannot edit files under .necro/. These are managed by necro.',
    };
  }
  if (hit) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Cannot edit frozen file ${hit.path}. Fix the code, not the contract.`,
    };
  }

  // Req 3.7: before a shell command runs, make sure each frozen spec has a
  // recorded tasks.md state to compare with afterwards.
  if (toolName === 'execute_bash') {
    const lock = readLock(cwd);
    for (const spec of Object.keys(lock.specs || {})) {
      if (readText(stateFile(cwd, spec)) !== null) continue;
      const current = readText(tasksFile(cwd, spec));
      if (current !== null) recordState(cwd, spec, current);
    }
    return ALLOW;
  }

  // Req 4: if this edit marks a task done, gate it on the frozen contracts.
  if (toolName === 'str_replace' || toolName === 'fs_write') {
    const edit = taskEdit(cwd, toolName, toolInput);
    if (edit) {
      if (newlyTicked(edit.before, edit.after)) {
        const gate = runGate(cwd, edit.spec);
        if (gate.exitCode !== 0) return gate;
      }
      // The edit is allowed: record the resulting tasks.md for the shell check.
      if (edit.exact && isSpecFrozen(cwd, edit.spec)) recordState(cwd, edit.spec, edit.after);
    }
  }

  // Req 3.4: nothing protected, no task marked done.
  return ALLOW;
}

// Gate: run the spec's frozen contracts; block unless they all pass. On
// success, write a receipt and allow the edit (Req 4.3-4.6).
function runGate(cwd, spec) {
  // Req 4.3: the spec must be frozen first.
  if (!isSpecFrozen(cwd, spec)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Spec '${spec}' is not frozen. Run 'necro freeze <spec>' first.`,
    };
  }

  const lock = readLock(cwd);
  // Req 4.4: run the frozen contracts with node --test.
  const results = runContracts(cwd, spec, lock);

  // Req 4.5: any failing contract blocks the edit, listing each by name.
  const failing = results.filter((r) => r.result === 'fail').map((r) => r.name);
  if (failing.length > 0) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Contracts failed: ${failing.sort().join(', ')}.`,
    };
  }

  // Req 4.6: all pass -> write a receipt and allow the edit.
  const receipt = buildReceipt(cwd, spec, lock, results);
  writeReceipt(cwd, spec, receipt);
  return ALLOW;
}

// ---------------------------------------------------------------------------
// PostToolUse
// ---------------------------------------------------------------------------

// Req 3.7: after a shell command, compare each frozen spec's tasks.md with the
// state the gate recorded. When a task changed from [ ] to [x], run the spec's
// contracts. If any fail, put tasks.md back to the recorded state. Returns the
// lines to print on stderr.
//
// With no recorded state (the gate never saw this spec) the baseline is the
// current file with every task unticked, so a tick nobody gated is checked
// rather than trusted.
function checkShellTicks(cwd, lock) {
  const messages = [];
  for (const spec of Object.keys(lock.specs || {})) {
    const file = tasksFile(cwd, spec);
    const current = readText(file);
    if (current === null) continue;
    const recorded = readText(stateFile(cwd, spec));
    const baseline = recorded !== null ? recorded : untick(current);

    if (!newlyTicked(baseline, current)) {
      recordState(cwd, spec, current);
      continue;
    }

    const results = runContracts(cwd, spec, lock);
    const failing = results.filter((r) => r.result === 'fail').map((r) => r.name);
    if (failing.length > 0) {
      fs.writeFileSync(file, baseline);
      recordState(cwd, spec, baseline);
      const rel = toRel(path.relative(cwd, file));
      messages.push(
        `Contracts failed: ${failing.sort().join(', ')}. Restored ${rel} to its last recorded state. Fix the code, then tick the task again.`,
      );
      continue;
    }
    writeReceipt(cwd, spec, buildReceipt(cwd, spec, lock, results));
    recordState(cwd, spec, current);
  }
  return messages;
}

// PostToolUse: after execute_bash, restore any frozen file whose SHA-256 changed
// back from its content-addressed copy in .necro/frozen/<hash> (Req 3.3), and
// undo a task tick that the contracts do not support (Req 3.7).
export function handlePostToolUse(payload) {
  const cwd = payload.cwd;
  const toolName = payload.tool_name;
  if (!cwd || toolName !== 'execute_bash') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lock = readLock(cwd);
  if (!lock.specs) return { exitCode: 0, stdout: '', stderr: '' };

  const messages = [];
  for (const spec of Object.keys(lock.specs)) {
    for (const f of frozenFiles(cwd, spec)) {
      const abs = path.join(cwd, f.path);
      let current = null;
      try {
        current = hashFile(abs);
      } catch {
        current = null; // file missing or unreadable
      }
      if (current !== f.sha256) {
        // Restore the exact frozen bytes from the content-addressed copy.
        const frozenCopy = path.join(cwd, '.necro', 'frozen', f.sha256);
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.copyFileSync(frozenCopy, abs);
          messages.push(`Restored frozen file ${f.path} after shell command.`);
        } catch {
          // frozen copy missing -> cannot restore, leave the file as-is
        }
      }
    }
  }

  messages.push(...checkShellTicks(cwd, lock));

  return { exitCode: 0, stdout: '', stderr: messages.join('\n') };
}

// Stop: print a session summary for each frozen spec (Req 7.1).
export function handleStop(payload) {
  const cwd = payload.cwd;
  if (!cwd) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lock = readLock(cwd);
  if (!lock.specs || Object.keys(lock.specs).length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lines = [];
  for (const spec of Object.keys(lock.specs).sort()) {
    // Count tasks done in .kiro/specs/<spec>/tasks.md
    let tasksDone = 0;
    try {
      const tasksPath = path.join(cwd, '.kiro', 'specs', spec, 'tasks.md');
      const tasksContent = fs.readFileSync(tasksPath, 'utf8');
      const matches = tasksContent.match(/\[x\]/gi);
      tasksDone = matches ? matches.length : 0;
    } catch {
      tasksDone = 0; // file missing
    }

    // Count receipts in .necro/receipts/<spec>/
    let receiptCount = 0;
    try {
      const receiptsDir = path.join(cwd, '.necro', 'receipts', spec);
      const files = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.json'));
      receiptCount = files.length;
    } catch {
      receiptCount = 0; // directory missing
    }

    // Run contracts and collect failing names
    const results = runContracts(cwd, spec, lock);
    const failing = results
      .filter((r) => r.result === 'fail')
      .map((r) => r.name)
      .sort();
    const contractStatus =
      failing.length === 0
        ? 'passing'
        : `failing: ${failing.join(', ')}`;

    const line = `Spec ${spec}: ${tasksDone} tasks done, ${receiptCount} receipts, ${contractStatus}.`;
    lines.push(line);
  }

  const output = lines.join('\n');
  return {
    exitCode: 0,
    stdout: output,
    stderr: '',
  };
}
