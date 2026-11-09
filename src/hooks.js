import fs from 'node:fs';
import path from 'node:path';
import { hashFile, sha256 } from './canon.js';
import { readLock, isSpecFrozen, frozenFiles, TASK_LINE, taskIdOf, requiredNames } from './lock.js';
import { runContracts } from './contracts.js';
import { buildReceipt, writeReceipt } from './receipts.js';
import { auditSpec, failingRequired, problems } from './audit.js';

const ALLOW = Object.freeze({ exitCode: 0, stdout: '', stderr: '' });

// Req 3.6: only these tools are known to be read-only: Kiro's documented read
// tools (read_file, list_directory, file_search, grep_search) and the CLI 2.x
// names (grep, glob). Any other tool is treated as a write when one of its input
// fields names a protected path.
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'file_search',
  'grep_search',
  'grep',
  'glob',
]);

// Req 3.12: every Kiro shell tool is handled like execute_bash.
const SHELL_TOOLS = new Set(['execute_bash', 'execute_pwsh', 'control_bash_process', 'control_pwsh_process']);

// Write tools that put file content in their input. For these, the content
// fields hold text, not paths. For every other tool all fields are checked.
// delete_file has no content; its path field is `targetFile`.
const CONTENT_WRITE_TOOLS = new Set(['fs_write', 'str_replace', 'fs_append']);

// Write tools whose `path` (or, for delete_file, `targetFile`) can name a tasks.md.
const TASK_WRITE_TOOLS = new Set(['fs_write', 'str_replace', 'fs_append', 'delete_file']);

const CONTENT_FIELDS = new Set(['text', 'oldStr', 'newStr']);

// Req 3.11: a string longer than this, or one holding a NUL character, cannot be
// checked as a path.
const MAX_PATH_STRING = 4096;

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
    if (value.length > 0 && value.length <= MAX_PATH_STRING && !value.includes('\0')) yield value;
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
    if (entry.runners) paths.push(entry.runners.path); // Req 13.5
    for (const f of entry.frozen || []) paths.push(f.path); // Req 13.9
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
  const knownWriteTool = CONTENT_WRITE_TOOLS.has(toolName);
  for (const candidate of pathCandidates(toolInput, knownWriteTool ? CONTENT_FIELDS : null)) {
    const hit = resolve(candidate);
    if (!hit) continue;
    if (hit.key === '.necro' || hit.key.startsWith('.necro/')) return { kind: 'necro' };
    if (frozen.has(hit.key)) return { kind: 'frozen', path: frozen.get(hit.key) };
  }
  return null;
}

// Req 3.11: true when a string in the tool input is too long to check or holds a
// NUL character. File content (text, oldStr, newStr of the two write tools) and a
// shell command are not paths, so they may be long.
function hasUncheckableString(toolName, toolInput) {
  const skip = new Set();
  if (CONTENT_WRITE_TOOLS.has(toolName)) for (const f of CONTENT_FIELDS) skip.add(f);
  if (SHELL_TOOLS.has(toolName)) skip.add('command');
  const bad = (value, top) => {
    if (typeof value === 'string') return value.length > MAX_PATH_STRING || value.includes('\0');
    if (Array.isArray(value)) return value.some((v) => bad(v, false));
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([k, v]) => !(top && skip.has(k)) && bad(v, false));
    }
    return false;
  };
  return bad(toolInput, true);
}

// ---------------------------------------------------------------------------
// Freezing is a person's step (Req 3.14)
// ---------------------------------------------------------------------------

// Characters that end a word in a shell command line when they are not quoted:
// command separators, pipes, redirections, grouping and backticks.
const SHELL_OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '`', '\n', '\r']);

// Split a shell command line into words, the way a POSIX shell would: quotes and
// backslashes are removed, and an unquoted operator ends the word and becomes a
// word of its own (as '\n', so adjacent words are always two words that follow
// each other in the same command). On Windows a backslash is a path separator, so
// it stays in the word.
// Returns [{ text, nested }]. `nested` is true for a word that holds a command
// substitution (`$(...)` or backticks) inside double quotes, which the shell runs.
function shellWords(command) {
  const words = [];
  let text = '';
  let started = false;
  let nested = false;
  const flush = () => {
    if (started) words.push({ text, nested });
    text = '';
    started = false;
    nested = false;
  };
  const windows = process.platform === 'win32';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'") {
      started = true;
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      text += command.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      started = true;
      let j = i + 1;
      let inner = '';
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length && !windows) j++;
        inner += command[j];
        j++;
      }
      if (inner.includes('$(') || inner.includes('`')) nested = true;
      text += inner;
      i = j;
    } else if (c === '\\' && !windows && i + 1 < command.length) {
      if (command[i + 1] === '\n') {
        i++; // a line continuation
      } else {
        started = true;
        text += command[++i];
      }
    } else if (SHELL_OPERATORS.has(c)) {
      flush();
      words.push({ text: '\n', nested: false });
    } else if (c === ' ' || c === '\t') {
      flush();
    } else {
      started = true;
      text += c;
    }
  }
  flush();
  return words;
}

// A word that names this tool: `necro`, `necro.js` (also the Windows shims), alone or
// at the end of a path such as `bin/necro.js`.
function isNecroWord(text) {
  const base = text.split(/[\\/]/).pop();
  return /^necro(\.js|\.cmd|\.exe|\.ps1)?$/i.test(base);
}

// A shell program: the word before an option such as `-c` that takes a command line.
const SHELL_PROGRAM = /^(sh|bash|zsh|dash|ksh|csh|tcsh|fish|pwsh|powershell|cmd)(\.exe)?$/i;

// A shell option that takes a command line as its next word: `-c`, `-lc`, `-ec`,
// PowerShell's `-Command`, and cmd's `/c`.
function takesCommandLine(text) {
  return /^-[a-zA-Z]*c$/.test(text) || /^[-/](c|command)$/i.test(text);
}

// Req 3.14: true when a shell command line runs `necro freeze`: the word `freeze`
// directly after a word that names this tool, anywhere in the command (after `&&`,
// `;`, `|`, in a subshell or command substitution), and inside the command line
// given to `bash -c`, `sh -c` or `eval`. Other uses of the word freeze, and other
// necro commands, do not count.
export function runsFreeze(command, depth = 0) {
  if (typeof command !== 'string' || depth > 8) return false;
  const words = shellWords(command);
  let shellSeen = false; // a shell program earlier in the same command
  for (let i = 0; i < words.length; i++) {
    const { text, nested } = words[i];
    if (text === '\n') {
      shellSeen = false;
      continue;
    }
    if (SHELL_PROGRAM.test(text.split(/[\\/]/).pop())) shellSeen = true;
    if (isNecroWord(text) && words[i + 1] && words[i + 1].text === 'freeze') return true;
    const prev = i > 0 ? words[i - 1].text : '';
    const runsAsCommand = nested || prev === 'eval' || (shellSeen && takesCommandLine(prev));
    if (runsAsCommand && /[\s;]/.test(text) && runsFreeze(text, depth + 1)) return true;
  }
  return false;
}

// The strings of a tool input, at any depth.
function* inputStrings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* inputStrings(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* inputStrings(v);
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

// The text of each task line that is ticked in `after` more often than in
// `before` (once per extra occurrence), in file order of the map.
function newlyTickedTexts(before, after) {
  const was = taskLines(before);
  const out = [];
  for (const [key, n] of taskLines(after)) {
    if (!key.startsWith('x\0')) continue;
    for (let i = was.get(key) || 0; i < n; i++) out.push(key.slice(2));
  }
  return out;
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
  // delete_file names its file in `targetFile`; the other write tools use `path`.
  const p = toolInput && (toolName === 'delete_file' ? toolInput.targetFile : toolInput.path);
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
  // Req 3.13: fs_append adds its text to the end of the file, on a new line when
  // the file does not end with one (and creates the file when it is missing).
  if (toolName === 'fs_append') {
    if (typeof toolInput.text !== 'string') return null;
    const gap = disk !== '' && !disk.endsWith('\n') ? '\n' : '';
    return { spec, before: disk, after: disk + gap + toolInput.text, exact: true };
  }
  // Req 3.13: delete_file removes the file, which ticks nothing.
  if (toolName === 'delete_file') {
    return { spec, before: disk, after: '', exact: true };
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

// Describe a `task_update` call from the Kiro IDE that sets a task to `completed`
// (Req 4.19, 4.20). The input is { tasksFilePath, taskId, status, error }; `taskId`
// is the task line text after the checkbox. Returns null for any other status, or
// { error } when the spec cannot be found (tasksFilePath outside the project, or
// not a spec's tasks.md), or { spec, change } where `change` is the same shape the
// gate takes for a tick written to tasks.md.
//
// The file is not changed. `after` is tasks.md on disk with the named line ticked,
// and `ticked` lists the task being completed. A taskId that matches no task line
// ticks nothing, which makes the gate require every contract.
function taskUpdateEdit(cwd, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (typeof input.status !== 'string' || input.status.trim().toLowerCase() !== 'completed') return null;

  const p = input.tasksFilePath;
  const hit = typeof p === 'string' && p !== '' ? projectResolver(cwd)(p) : null;
  const m = hit ? TASKS_PATH.exec(hit.rel) : null;
  if (!m) {
    return {
      error:
        'Cannot find the spec for this task. tasksFilePath must be .kiro/specs/<spec>/tasks.md inside the project.',
    };
  }

  let disk = '';
  try {
    disk = fs.readFileSync(path.resolve(cwd, p), 'utf8');
  } catch {
    disk = ''; // the file does not exist
  }

  const wanted = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const lines = disk.split(/(\r?\n)/); // keeps the line breaks at the odd indexes
  const found = [];
  for (let i = 0; i < lines.length; i += 2) {
    const line = TASK_LINE.exec(lines[i]);
    if (line && wanted !== '' && line[2].trim() === wanted) found.push(i);
  }
  for (const i of found) lines[i] = lines[i].replace(/\[[ xX]\]/, '[x]');

  return {
    spec: canonicalSpec(cwd, m[1]),
    change: { before: disk, after: lines.join(''), exact: true, ticked: found.length > 0 ? [wanted] : [] },
  };
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

// The SHA-256 of the record is kept next to it, so PostToolUse can tell that a
// command changed the record while it ran (Req 3.9).
function stateHashFile(cwd, spec) {
  return `${stateFile(cwd, spec)}.sha256`;
}

function recordState(cwd, spec, text) {
  const file = stateFile(cwd, spec);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(stateHashFile(cwd, spec), sha256(text));
}

// The recorded tasks.md state, or null when there is none or it no longer matches
// the hash written with it (a command edited or deleted it).
function readTrustedState(cwd, spec) {
  const text = readText(stateFile(cwd, spec));
  if (text === null) return null;
  const hash = readText(stateHashFile(cwd, spec));
  return hash !== null && hash.trim() === sha256(text) ? text : null;
}

// ---------------------------------------------------------------------------
// Recorded lock (Req 3.15)
//
// Freezing rewrites the lock that `verify` trusts, so it is a person's step. A
// shell command can rewrite the lock in ways no one can recognise in advance (a
// variable, `node -e`, a direct write), so PreToolUse records the lock and
// PostToolUse puts it back, whatever the command was.
// ---------------------------------------------------------------------------

const LOCK_REL = '.necro/lock.json';

function lockRecordFile(cwd) {
  return path.join(cwd, '.necro', 'state', 'lock.json');
}

// A marker that says the lock did not exist when it was recorded.
function lockAbsentFile(cwd) {
  return path.join(cwd, '.necro', 'state', 'lock.absent');
}

// The bytes of the lock, or null when there is no lock file (a directory or a
// broken link counts as no file).
function readLockBytes(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, LOCK_REL));
  } catch {
    return null;
  }
}

function recordLock(cwd) {
  const bytes = readLockBytes(cwd);
  const record = lockRecordFile(cwd);
  const absent = lockAbsentFile(cwd);
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.rmSync(record, { force: true });
  fs.rmSync(absent, { force: true });
  if (bytes === null) fs.writeFileSync(absent, '');
  else fs.writeFileSync(record, bytes);
}

// Put the lock back to the recorded bytes, or remove it when it was recorded as
// absent. Returns true when the lock had to be changed. With no record (the pre
// handler never ran) nothing is touched.
function restoreLock(cwd) {
  const lockAbs = path.join(cwd, LOCK_REL);
  let wanted;
  try {
    wanted = fs.readFileSync(lockRecordFile(cwd));
  } catch {
    if (!fs.existsSync(lockAbsentFile(cwd))) return false;
    wanted = null;
  }
  let stat = null;
  try {
    stat = fs.lstatSync(lockAbs);
  } catch {
    stat = null; // no lock
  }
  if (wanted === null && stat === null) return false;
  const current = stat !== null && stat.isFile() ? readLockBytes(cwd) : null;
  if (wanted !== null && current !== null && current.equals(wanted)) return false;
  // A directory or a symbolic link where the lock belongs is removed first, so
  // the lock comes back as a plain file.
  fs.rmSync(lockAbs, { recursive: true, force: true });
  if (wanted !== null) {
    fs.mkdirSync(path.dirname(lockAbs), { recursive: true });
    fs.writeFileSync(lockAbs, wanted);
  }
  return true;
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

  // Req 3.14: freezing is a person's step, because it rewrites the lock that
  // `necro verify` trusts. A shell command that runs `necro freeze` is blocked.
  if (SHELL_TOOLS.has(toolName) && [...inputStrings(toolInput)].some((s) => runsFreeze(s))) {
    return {
      exitCode: 2,
      stdout: '',
      stderr:
        "Freezing a spec is a person's step, so 'necro freeze' cannot run from the agent. It rewrites the lock that 'necro verify' trusts. Ask the person to review the contracts and freeze the spec themselves.",
    };
  }

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

  // Req 3.11: a tool input that cannot be checked is not let through.
  if (hasUncheckableString(toolName, toolInput)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'Cannot check this tool call because an input string is too long or holds a NUL character. Shorten the input and try again.',
    };
  }

  // Req 3.8: before a shell command runs, record each frozen spec's current
  // tasks.md as the state to compare with afterwards, replacing any earlier record.
  if (SHELL_TOOLS.has(toolName)) {
    // Req 3.15: record the lock too, so PostToolUse can put it back.
    recordLock(cwd);
    const lock = readLock(cwd);
    for (const spec of Object.keys(lock.specs || {})) {
      const current = readText(tasksFile(cwd, spec));
      if (current !== null) recordState(cwd, spec, current);
    }
    return ALLOW;
  }

  // Req 4.19, 4.20: the Kiro IDE's task tool marks a task done without writing the
  // file through a tool the hook can read, so `completed` is gated like a tick.
  if (toolName === 'task_update') {
    const update = taskUpdateEdit(cwd, toolInput);
    if (update === null) return ALLOW; // in_progress, queued, task_list: not a completion
    if (update.error) return { exitCode: 2, stdout: '', stderr: update.error };
    return runGate(cwd, update.spec, update.change);
  }

  // Req 4: if this edit marks a task done, gate it on the frozen contracts.
  if (TASK_WRITE_TOOLS.has(toolName)) {
    const edit = taskEdit(cwd, toolName, toolInput);
    if (edit) {
      if (newlyTicked(edit.before, edit.after)) {
        const gate = runGate(cwd, edit.spec, edit);
        if (gate.exitCode !== 0) return gate;
      }
      // Req 3.10: the state is recorded by PostToolUse, once the write has landed.
    }
  }

  // Req 3.4: nothing protected, no task marked done.
  return ALLOW;
}

// Decide a tick (Req 4.5, 4.14, 4.15, 5.5). `change` is { before, after, exact, ticked? }:
// tasks.md before and after the change, and optionally the ticked task texts. Every frozen contract of the spec has been
// run (`results`). The tasks being ticked are the task lines ticked in `after`
// and not in `before`; which contracts they require comes from the lock, see
// requiredNames. A change whose lines cannot be read exactly requires everything.
// Returns { failing, required, task }: the sorted names of failing required
// contracts, the sorted names that were required, and the ticked task as
// { id, line } (null when no task line can be named).
function decideTicks(lock, spec, results, change) {
  const names = [...new Set(results.map((r) => r.name))].sort();
  // `change.ticked` names the tasks directly when the tool does (task_update, Req 4.19).
  const ticked = change.ticked ?? (change.exact ? newlyTickedTexts(change.before, change.after) : []);
  const required = requiredNames(lock, spec, ticked, change.after, names) || names;
  // Req 4.17: a contract file that holds a required contract and failed as a whole
  // (it did not load, or exited badly) fails the tick, even when the required
  // contract passed on its own. The runner reports such a file as a failing
  // result named after the file.
  const failing = failingRequired(results, required);
  let task = null;
  if (ticked.length > 0) {
    const ids = ticked.map(taskIdOf);
    task = { id: ids.length === 1 ? ids[0] : ids.map((i) => i ?? '?').join(', '), line: ticked.join('\n') };
  }
  // Req 13.4: a contract file that gave no usable report says why, naming the file.
  const reasons = [...new Set(results.filter((r) => r.result === 'fail' && failing.includes(r.name) && r.reason).map((r) => r.reason))];
  return { failing, required, task, reasons };
}

// "Contracts failed: a, b." and, for contract files that could not run, the reasons (Req 4.5, 13.4).
function failedMessage(failing, reasons) {
  return [`Contracts failed: ${failing.join(', ')}.`, ...reasons].join(' ');
}

// Gate: run the spec's frozen contracts; block unless the contracts the ticked
// task requires all pass. On success, write a receipt and allow the edit
// (Req 4.3-4.6, 4.14).
function runGate(cwd, spec, change) {
  // Req 4.3: the spec must be frozen first.
  if (!isSpecFrozen(cwd, spec)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Spec '${spec}' is not frozen. Run 'necro freeze <spec>' first.`,
    };
  }

  const lock = readLock(cwd);
  // Req 4.4, 4.14: run every frozen contract with node --test.
  const results = runContracts(cwd, spec, lock);
  const { failing, required, task, reasons } = decideTicks(lock, spec, results, change);

  // Req 4.5: a failing required contract blocks the edit, listing each by name.
  if (failing.length > 0) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: failedMessage(failing, reasons),
    };
  }

  // Req 4.6, 5.5: the required contracts pass -> write a receipt and allow the edit.
  const receipt = buildReceipt(cwd, spec, lock, results, { task, required });
  writeReceipt(cwd, spec, receipt);
  return ALLOW;
}

// ---------------------------------------------------------------------------
// PostToolUse
// ---------------------------------------------------------------------------

// Req 3.7, 3.9: after a shell command, compare each frozen spec's tasks.md with the
// state the gate recorded. When a task changed from [ ] to [x], run the spec's
// contracts. If any fail, put tasks.md back to the recorded state. Returns the
// lines to print on stderr.
//
// With no trusted recorded state (the gate never saw this spec, or a command
// changed the record while it ran) the baseline is the current file with every
// task unticked, so a tick nobody gated is checked rather than trusted.
function checkShellTicks(cwd, lock) {
  const messages = [];
  for (const spec of Object.keys(lock.specs || {})) {
    const file = tasksFile(cwd, spec);
    const current = readText(file);
    if (current === null) continue;
    // Req 3.9: when the record is missing or changed during the command, it is not
    // trusted and every ticked task line counts as newly ticked.
    const recorded = readTrustedState(cwd, spec);
    const baseline = recorded !== null ? recorded : untick(current);

    if (!newlyTicked(baseline, current)) {
      recordState(cwd, spec, current);
      continue;
    }

    const results = runContracts(cwd, spec, lock);
    const { failing, required, task, reasons } = decideTicks(lock, spec, results, { before: baseline, after: current, exact: true });
    if (failing.length > 0) {
      fs.writeFileSync(file, baseline);
      recordState(cwd, spec, baseline);
      const rel = toRel(path.relative(cwd, file));
      messages.push(
        `${failedMessage(failing, reasons)} Restored ${rel} to its last recorded state. Fix the code, then tick the task again.`,
      );
      continue;
    }
    writeReceipt(cwd, spec, buildReceipt(cwd, spec, lock, results, { task, required }));
    recordState(cwd, spec, current);
  }
  return messages;
}

// Req 3.10: after a write to a frozen spec's tasks.md has been applied, record the
// file as it is on disk, not as the hook predicted it before the write.
function recordWrittenTasks(cwd, toolName, toolInput) {
  const p = toolInput && (toolName === 'delete_file' ? toolInput.targetFile : toolInput.path);
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return;
  const hit = projectResolver(cwd)(p);
  if (!hit) return;
  const m = TASKS_PATH.exec(hit.rel);
  if (!m) return;
  const spec = canonicalSpec(cwd, m[1]);
  if (!isSpecFrozen(cwd, spec)) return;
  const current = readText(tasksFile(cwd, spec));
  if (current !== null) recordState(cwd, spec, current);
}

// PostToolUse: after a shell tool (Req 3.12), restore the lock (Req 3.15), then restore any frozen file whose SHA-256 changed
// back from its content-addressed copy in .necro/frozen/<hash> (Req 3.3), and
// undo a task tick that the contracts do not support (Req 3.7).
//
// After fs_write, str_replace, fs_append or delete_file, record the tasks.md of a frozen spec from the file
// on disk (Req 3.10).
export function handlePostToolUse(payload) {
  const cwd = payload.cwd;
  const toolName = payload.tool_name;
  if (cwd && TASK_WRITE_TOOLS.has(toolName)) {
    recordWrittenTasks(cwd, toolName, payload.tool_input);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  if (!cwd || !SHELL_TOOLS.has(toolName)) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // Req 3.15: first of all, put back the lock the person froze, so the checks
  // below run against it and not against a lock the command wrote.
  const messages = [];
  if (restoreLock(cwd)) {
    messages.push(
      `Restored ${LOCK_REL} after shell command. Freezing a spec is a person's step, so the lock was put back to what it was before the command.`,
    );
  }

  const lock = readLock(cwd);
  if (!lock.specs) return { exitCode: 0, stdout: '', stderr: messages.join('\n') };

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

// Req 14.3: put every ticked task that is not ok (Req 14.1) back to `[ ]` in its
// tasks.md and return one message per task undone, with the reason. `audits` are the
// results of auditSpec for the frozen specs. The tasks.md is recorded afterwards, as
// after any other write to it (Req 3.10). Line endings and everything else in the file
// stay as they were.
function undoUnsupportedTicks(cwd, audits) {
  const messages = [];
  for (const audit of audits) {
    const bad = problems(audit);
    if (bad.length === 0) continue;
    const file = tasksFile(cwd, audit.spec);
    const rel = toRel(path.relative(cwd, file));
    const text = readText(file);
    if (text === null) continue;
    const parts = text.split(/(\r?\n)/); // keeps the line breaks at the odd indexes
    const undone = [];
    for (const t of bad) {
      const before = parts[t.index * 2];
      const after = before.replace(/\[[xX]\]/, '[ ]');
      if (after !== before) {
        parts[t.index * 2] = after;
        undone.push(t);
      }
    }
    if (undone.length === 0) continue;
    const next = parts.join('');
    fs.writeFileSync(file, next);
    recordState(cwd, audit.spec, next);
    for (const t of undone) {
      messages.push(`Unticked "${t.text}" in ${rel}: ${t.reason}. Fix the code, then tick the task again through the gate.`);
    }
  }
  return messages;
}

// Audit every frozen spec and undo the ticks that are not ok (Req 14.3). `resultsBySpec`
// holds contract results the caller already has. A spec whose lock records no list of
// tasks ticked at freeze was frozen before Req 14: it is left alone, so an upgrade does
// not untick a project's older work, and one message says a person must freeze it again
// (Req 14.6). `necro audit` still reports every verdict for it.
function auditAndUndo(cwd, lock, resultsBySpec = {}) {
  const messages = [];
  const audits = [];
  for (const spec of Object.keys(lock.specs || {}).sort()) {
    if (!Array.isArray(lock.specs[spec] && lock.specs[spec].ticked)) {
      messages.push(
        `Spec ${spec} was frozen before the lock recorded ticked tasks, so no tick of it is checked or undone. Ask a person to freeze it again to turn the check on.`,
      );
      continue;
    }
    audits.push(auditSpec(cwd, spec, lock, resultsBySpec[spec] || null));
  }
  return [...messages, ...undoUnsupportedTicks(cwd, audits)];
}

// PostTaskExec (Req 14.3): when Kiro finishes a spec task, find every ticked task that is
// not ok and put it back to `[ ]`. Kiro documents no stdin payload for this trigger, so
// nothing in the input is used: the project is the current folder, and all frozen specs
// are audited. Always exits 0; the tasks undone are listed on stderr.
export function handlePostTaskExec(payload) {
  const cwd = payload && typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
  const messages = auditAndUndo(cwd, readLock(cwd));
  return { exitCode: 0, stdout: '', stderr: messages.join('\n') };
}

// Stop: print a session summary for each frozen spec (Req 7.1), then undo the ticks that
// are not ok (Req 14.3). The summary counts the ticks Stop found, before the undo.
export function handleStop(payload) {
  const cwd = payload && payload.cwd;
  if (!cwd) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lock = readLock(cwd);
  if (!lock.specs || Object.keys(lock.specs).length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lines = [];
  const resultsBySpec = {};
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
    resultsBySpec[spec] = results;
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
    stderr: auditAndUndo(cwd, lock, resultsBySpec).join('\n'),
  };
}
