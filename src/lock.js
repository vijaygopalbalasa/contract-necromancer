import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './canon.js';
import { runContracts } from './contracts.js';

const LOCK_FILE = path.join('.necro', 'lock.json');
const FROZEN_DIR = path.join('.necro', 'frozen');

// Normalize a path to forward slashes, project-relative style.
function toRel(p) {
  return p.split(path.sep).join('/');
}

// Recursively sort object keys so the lock file has clean, stable git diffs.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

export function readLock(cwd) {
  const file = path.join(cwd, LOCK_FILE);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { specs: {} };
    throw e;
  }
}

export function writeLock(cwd, lock) {
  const file = path.join(cwd, LOCK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sortKeys(lock), null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Tasks and their criteria (Req 2.7, 4.14, 4.15)
// ---------------------------------------------------------------------------

// A task line: an optional list marker, then a checkbox. The marker is optional
// so a box written without one still counts (Req 4.13). Group 1 is the box state,
// group 2 the text after the box.
export const TASK_LINE = /^\s*(?:(?:[-*+]|\d+[.)])\s*)?\[([ xX])\]\s?(.*)$/;

// Criteria named on a task line: every "N.N" inside a parenthesis that contains
// the word "Req", as in "(Req 1.2, 3.1)" or "(supports Req 4.4)". Sorted by
// number and unique, so two lines naming the same set compare equal.
export function criteriaOf(text) {
  const found = new Set();
  for (const group of text.matchAll(/\(([^()]*)\)/g)) {
    if (!/\bReq\b/.test(group[1])) continue;
    for (const m of group[1].matchAll(/\d+\.\d+/g)) found.add(m[0]);
  }
  const num = (c) => c.split('.').map(Number);
  return [...found].sort((a, b) => {
    const [a1, a2] = num(a);
    const [b1, b2] = num(b);
    return a1 - b1 || a2 - b2;
  });
}

// The task id of a task line's text (the text after the checkbox): everything
// before the first ".", trimmed. Null when there is no dot or nothing before it.
export function taskIdOf(text) {
  const dot = text.indexOf('.');
  if (dot < 0) return null;
  const id = text.slice(0, dot).trim();
  return id === '' ? null : id;
}

// Every task in a tasks.md text: [{ id, text, criteria }] in file order. A line
// without an id is skipped.
export function parseTasks(markdown) {
  const tasks = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    const id = taskIdOf(text);
    if (id !== null) tasks.push({ id, text, criteria: criteriaOf(text) });
  }
  return tasks;
}

// The task table recorded in the lock: { <id>: { criteria: [...] } }. An id that
// is used by more than one task line is ambiguous, so it is recorded with no
// criteria, which makes ticking it require every contract (Req 4.15).
function taskTable(cwd, spec) {
  let markdown = '';
  try {
    markdown = fs.readFileSync(path.join(cwd, '.kiro', 'specs', spec, 'tasks.md'), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const table = {};
  const seen = new Set();
  for (const t of parseTasks(markdown)) {
    table[t.id] = { criteria: seen.has(t.id) ? [] : t.criteria };
    seen.add(t.id);
  }
  return table;
}

// Which contracts must pass before the given tasks may be ticked. `ticked` is the
// list of ticked task texts (the text after the checkbox). `unticked` is how many
// task lines stay unticked afterwards. `names` are the contract names of the run.
//
// The criteria come only from the lock (Req 4.14). The line in tasks.md is used
// to find the task id and to notice that the line was edited; it never supplies
// criteria. Returns a sorted list of names, or null when every contract is
// required (Req 4.15): no identifiable ticked task, the last unticked task, an
// id the lock lacks, an edited line, no criteria recorded, or no contract
// matching them.
export function requiredNames(lock, spec, ticked, unticked, names) {
  if (ticked.length === 0 || unticked === 0) return null;
  const table = (lock && lock.specs && lock.specs[spec] && lock.specs[spec].tasks) || {};
  const required = new Set();
  for (const text of ticked) {
    const id = taskIdOf(text);
    const recorded = id !== null && Object.hasOwn(table, id) ? table[id] : null;
    const criteria = recorded && Array.isArray(recorded.criteria) ? recorded.criteria : [];
    if (criteria.length === 0) return null;
    // The lock stores criteria in the order criteriaOf returns them.
    if (criteriaOf(text).join(',') !== criteria.join(',')) return null;
    const matching = names.filter((n) => criteria.some((c) => n === `R${c}` || n.startsWith(`R${c} `)));
    if (matching.length === 0) return null;
    for (const n of matching) required.add(n);
  }
  return [...required].sort();
}

// Filename stem of a contract file, e.g. "canon" from "canon.contract.test.js".
function contractName(filePath) {
  return path.basename(filePath).replace(/\.contract\.test\.js$/, '');
}

function listContractFiles(cwd, spec) {
  const dir = path.join(cwd, 'contracts', spec);
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.contract.test.js'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  entries.sort();
  return entries.map((f) => toRel(path.join('contracts', spec, f)));
}

export function freezeSpec(cwd, spec) {
  const reqRel = toRel(path.join('.kiro', 'specs', spec, 'requirements.md'));
  const reqAbs = path.join(cwd, reqRel);
  if (!fs.existsSync(reqAbs)) {
    throw new Error(`No requirements.md found for spec '${spec}'. Expected ${reqRel}.`);
  }
  const reqHash = hashFile(reqAbs);

  const contractPaths = listContractFiles(cwd, spec);
  if (contractPaths.length === 0) {
    throw new Error(`No contracts found for spec '${spec}'. Add at least one file in contracts/${spec}/.`);
  }

  // Req 2.6: a contract path that resolves outside the project root is refused.
  // Resolve symlinks so a file linked in from elsewhere cannot sneak out.
  const realCwd = fs.realpathSync(cwd);
  for (const p of contractPaths) {
    const real = fs.realpathSync(path.join(cwd, p));
    if (!insideRoot(realCwd, real)) {
      throw new Error(`Contract '${p}' resolves outside the project root. Move it inside the project.`);
    }
  }

  const contracts = contractPaths.map((p) => ({
    name: contractName(p),
    path: p,
    sha256: hashFile(path.join(cwd, p)),
  }));

  // Req 2.5: run the contracts once and record the name of every contract in the
  // lock. Names come from the run results (one per named test), grouped by file.
  const partialLock = { specs: { [spec]: { contracts } } };
  const results = runContracts(cwd, spec, partialLock);
  const namesByPath = {};
  for (const r of results) {
    (namesByPath[r.path] ||= []).push(r.name);
  }
  for (const c of contracts) {
    c.names = namesByPath[c.path] || [];
  }

  const lock = readLock(cwd);
  lock.specs = lock.specs || {};
  lock.specs[spec] = {
    frozenAt: new Date().toISOString(),
    requirements: { path: reqRel, sha256: reqHash },
    contracts,
    tasks: taskTable(cwd, spec),
  };
  writeLock(cwd, lock);

  // Store raw copies of every frozen file, content-addressed by hash.
  const frozenDir = path.join(cwd, FROZEN_DIR);
  fs.mkdirSync(frozenDir, { recursive: true });
  copyFrozen(frozenDir, reqAbs, reqHash);
  for (const c of contracts) copyFrozen(frozenDir, path.join(cwd, c.path), c.sha256);
}

// True when `target` is `root` or somewhere beneath it (both resolved to real paths).
function insideRoot(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function copyFrozen(frozenDir, absPath, hash) {
  fs.copyFileSync(absPath, path.join(frozenDir, hash));
}

export function isSpecFrozen(cwd, spec) {
  const lock = readLock(cwd);
  return Boolean(lock.specs && lock.specs[spec]);
}

export function isFrozenPath(cwd, relPath) {
  relPath = toRel(relPath);
  const lock = readLock(cwd);
  if (!lock.specs) return false;
  for (const spec of Object.keys(lock.specs)) {
    const entry = lock.specs[spec];
    if (entry.requirements && entry.requirements.path === relPath) return true;
    if (entry.contracts && entry.contracts.some((c) => c.path === relPath)) return true;
  }
  return false;
}

export function frozenFiles(cwd, spec) {
  const lock = readLock(cwd);
  const entry = lock.specs && lock.specs[spec];
  if (!entry) return [];
  const out = [];
  if (entry.requirements) out.push({ path: entry.requirements.path, sha256: entry.requirements.sha256 });
  if (entry.contracts) for (const c of entry.contracts) out.push({ path: c.path, sha256: c.sha256 });
  return out;
}

export function getExpectedHash(cwd, relPath) {
  relPath = toRel(relPath);
  const lock = readLock(cwd);
  if (!lock.specs) return null;
  for (const spec of Object.keys(lock.specs)) {
    const entry = lock.specs[spec];
    if (entry.requirements && entry.requirements.path === relPath) return entry.requirements.sha256;
    for (const c of entry.contracts || []) {
      if (c.path === relPath) return c.sha256;
    }
  }
  return null;
}
