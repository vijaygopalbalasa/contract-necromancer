import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from './canon.js';
import { parseJunit } from './junit.js';

// Contracts in any language (Req 13). A spec may hold `.kiro/specs/<spec>/runners.json`:
// a JSON object that maps a file-name pattern to a command.
//
//   { "test_*_contract.py": "python3 -m pytest {file} --junitxml={report} -q" }
//
// A file in `contracts/<spec>/` whose name matches a pattern is a contract file of
// the spec, alongside `*.contract.test.js` (which always runs on node:test). The
// command is split into arguments and started without a shell. `{file}` becomes
// the absolute path of the contract file and `{report}` a new path inside a fresh
// temporary folder. Results are read only from the JUnit XML written there.
//
// Two keys of runners.json are reserved and are not patterns (Req 13.9): `"sources"`,
// a list of globs (relative to the project root) of files the contracts exercise,
// pinned in every receipt; and `"frozen"`, a list of globs of files (a `conftest.py`,
// a `pytest.ini`) that are locked with the spec like its contracts.

// Where a spec's runners.json lives, project-relative with forward slashes.
export function runnersRel(spec) {
  return `.kiro/specs/${spec}/runners.json`;
}

// Split a command line into arguments the way a shell would for plain words and
// quotes, and nothing more: words are separated by spaces or tabs, a quoted part
// ("..." or '...') is kept whole, and every other character, including `;`, `&`,
// `|`, `$`, `>` and a backslash, is an ordinary character. Throws on an unclosed quote.
export function splitCommand(command) {
  const args = [];
  let word = '';
  let started = false;
  let quote = null;
  for (const c of command) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (started) args.push(word);
      word = '';
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (quote) throw new Error(`A quote is not closed in the command: ${command}`);
  if (started) args.push(word);
  return args;
}

function badRunners(why) {
  return new Error(`runners.json ${why}. Fix it, then freeze the spec again.`);
}

// The keys of runners.json that are lists of globs and not file-name patterns (Req 13.9).
const RESERVED_KEYS = ['sources', 'frozen'];

// A list of globs relative to the project root: strings made of folder and file
// names with `*`, `?` and `**`; nothing absolute, nothing that leaves the project.
function parseGlobList(key, value) {
  if (!Array.isArray(value)) throw badRunners(`needs "${key}" to be a list of file globs relative to the project root`);
  for (const glob of value) {
    const ok =
      typeof glob === 'string' &&
      glob !== '' &&
      !/[\\\0]/.test(glob) &&
      !glob.startsWith('/') &&
      !/^[A-Za-z]:/.test(glob) &&
      glob.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
    if (!ok) throw badRunners(`has "${typeof glob === 'string' ? glob : JSON.stringify(glob)}" in "${key}", which is not a file glob relative to the project root`);
  }
  return [...value];
}

// Read the text of a runners.json into { patterns: [{ pattern, command }], sources, frozen }.
// Throws an Error that names runners.json when the text is not a JSON object of
// file-name patterns (a name in contracts/<spec>/, with * and ?) to non-empty commands,
// plus the reserved keys "sources" and "frozen", each a list of globs.
export function parseRunnersConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRunners('is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw badRunners('must be a JSON object that maps a file-name pattern to a command');
  }
  const patterns = [];
  let sources = [];
  let frozen = [];
  for (const [pattern, command] of Object.entries(data)) {
    if (pattern === 'sources') {
      sources = parseGlobList(pattern, command);
      continue;
    }
    if (pattern === 'frozen') {
      frozen = parseGlobList(pattern, command);
      continue;
    }
    if (pattern === '' || pattern === '.' || pattern === '..' || /[/\\\0]/.test(pattern)) {
      throw badRunners(`has the pattern "${pattern}", which is not a file name in contracts/<spec>/`);
    }
    if (typeof command !== 'string' || command.trim() === '') {
      throw badRunners(`needs a command for the pattern "${pattern}"`);
    }
    let args;
    try {
      args = splitCommand(command);
    } catch (e) {
      throw badRunners(`has a command that cannot be read for the pattern "${pattern}": ${e.message}`);
    }
    if (args.length === 0 || args[0] === '') throw badRunners(`needs a program in the command for the pattern "${pattern}"`);
    patterns.push({ pattern, command });
  }
  return { patterns, sources, frozen };
}

// The file-name patterns of a runners.json text, in file order (see parseRunnersConfig).
export function parseRunners(text) {
  return parseRunnersConfig(text).patterns;
}

// Read a spec's runners.json from disk. Returns null when the file does not
// exist, otherwise { path, sha256, patterns, sources, frozen }. Throws when it cannot be read or parsed.
export function readRunners(cwd, spec) {
  const rel = runnersRel(spec);
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(cwd, rel));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${rel}. Check that it is a file in the project.`);
  }
  return { path: rel, sha256: sha256(bytes), ...parseRunnersConfig(bytes.toString('utf8')) };
}

// The settings ({ patterns, sources, frozen }) of a runners.json pinned in the lock
// (`entry.runners`), or null when the file on disk is missing, differs from the pinned
// hash, or cannot be parsed. The bytes that are hashed are the bytes that are parsed.
export function lockedRunnersConfig(cwd, pinned) {
  if (!pinned || typeof pinned.path !== 'string' || typeof pinned.sha256 !== 'string') return null;
  let bytes;
  try {
    bytes = fs.readFileSync(path.resolve(cwd, pinned.path));
  } catch {
    return null;
  }
  if (sha256(bytes) !== pinned.sha256) return null;
  try {
    return parseRunnersConfig(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

// The patterns of a pinned runners.json, or null (see lockedRunnersConfig).
export function lockedRunners(cwd, pinned) {
  const config = lockedRunnersConfig(cwd, pinned);
  return config === null ? null : config.patterns;
}

function globToRegExp(pattern) {
  let source = '';
  for (const c of pattern) {
    if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 's');
}

// True when a file name matches a pattern. `*` matches any run of characters and
// `?` one character; nothing else is special, and neither crosses a folder.
export function matchesPattern(pattern, fileName) {
  return globToRegExp(pattern).test(fileName);
}

// The command of the first pattern that matches the file name, or null.
export function findRunner(patterns, fileName) {
  const hit = patterns.find((p) => matchesPattern(p.pattern, fileName));
  return hit ? hit.command : null;
}

// Folders that glob wildcards do not descend into: version control, the tool's own
// records, installed packages and compiled files. Naming one in full still reaches it.
const SKIPPED_FOLDERS = new Set(['.git', '.necro', 'node_modules', '__pycache__']);

function walkGlob(cwd, rel, segments, found) {
  const [segment, ...rest] = segments;
  let entries;
  try {
    entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true });
  } catch {
    return;
  }
  const at = (name) => (rel === '' ? name : `${rel}/${name}`);
  if (segment === '**') {
    // `**` is zero or more folders. With nothing after it, it also takes every file below.
    if (rest.length > 0) walkGlob(cwd, rel, rest, found);
    for (const e of entries) {
      if (e.isDirectory() && !SKIPPED_FOLDERS.has(e.name)) walkGlob(cwd, at(e.name), segments, found);
      else if (rest.length === 0 && e.isFile()) found.add(at(e.name));
    }
    return;
  }
  const wild = /[*?]/.test(segment);
  for (const e of entries) {
    if (!matchesPattern(segment, e.name)) continue;
    if (rest.length === 0) {
      if (e.isFile()) found.add(at(e.name));
    } else if (e.isDirectory() && !(wild && SKIPPED_FOLDERS.has(e.name))) {
      walkGlob(cwd, at(e.name), rest, found);
    }
  }
}

// The regular files of the project that match any of the globs, as sorted,
// project-relative paths with forward slashes. `*` and `?` stay inside one name,
// `**` stands for any number of folders. Symbolic links are not followed or listed.
export function expandGlobs(cwd, globs) {
  const found = new Set();
  for (const glob of globs) walkGlob(cwd, '', glob.split('/'), found);
  return [...found].sort();
}

// Req 13.7: how long a runner command, or a JavaScript contract file, may run. The
// default is below the hooks' own limit of 300 seconds. The environment variable
// NECRO_RUNNER_TIMEOUT_MS can make it shorter, never longer.
export const RUNNER_TIME_LIMIT_MS = 240 * 1000;

export function runnerTimeLimitMs(env = process.env) {
  const raw = env.NECRO_RUNNER_TIMEOUT_MS;
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) return Math.min(Number(raw), RUNNER_TIME_LIMIT_MS);
  return RUNNER_TIME_LIMIT_MS;
}

// A plain sentence about a run that hit the time limit.
export function timeoutReason(file, limitMs) {
  return `${file} ran longer than the time limit of ${limitMs / 1000} seconds and was stopped, so it counts as failing. Fix a hang in the code under test, or make the contracts faster.`;
}

// Run a program like spawnSync, with the runner time limit (Req 13.7). The program
// starts in its own process group; when the limit is hit it is killed, and so is every
// process left in its group. Returns { res, timedOut, limitMs }.
export function spawnLimited(program, args, options) {
  const limitMs = runnerTimeLimitMs();
  const windows = process.platform === 'win32';
  const res = spawnSync(program, args, { ...options, timeout: limitMs, killSignal: 'SIGKILL', detached: !windows });
  const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  if (timedOut && res.pid) {
    try {
      if (windows) spawnSync('taskkill', ['/pid', String(res.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else process.kill(-res.pid, 'SIGKILL');
    } catch {
      // nothing is left in the group
    }
  }
  return { res, timedOut, limitMs };
}

// Read and parse the report at `report`: { cases } or { reason }.
function readCases(report, file) {
  let xml;
  try {
    xml = fs.readFileSync(report, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { reason: `The command for ${file} wrote no report at {report}. Check that runners.json passes {report} to the test framework.` };
    }
    return { reason: `The report for ${file} could not be read (${e.code || e.message}). Check that it is a file of reasonable size.` };
  }
  let cases;
  try {
    cases = parseJunit(xml);
  } catch (e) {
    return { reason: `The report for ${file} could not be read. ${e.message}` };
  }
  if (cases.length === 0) return { reason: `The report for ${file} holds no testcase, so no contract ran.` };
  return { cases };
}

// Run one contract file with its command and read the JUnit XML report.
// Returns { cases: [{ name, outcome }] }, or { reason } (a plain sentence naming
// the file) when the command cannot start, runs past the time limit, writes no
// report, writes XML that does not parse, or writes a report with no testcase.
// Req 13.7: a command that exits with a non-zero status fails the file. The
// result then holds { cases, reason } when the report could still be read, and the
// caller counts every case as failing; otherwise only { reason }.
// `env` is the environment of the command. Nothing the command prints is read.
export function runReport(cwd, absPath, command, env) {
  const file = path.basename(absPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-report-'));
  let pycache = null;
  try {
    // Req 13.8: bytecode written earlier cannot stand in for changed source, because the
    // command looks for compiled files only in a new, empty folder and writes none.
    pycache = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-pycache-'));
    const report = path.join(dir, 'report.xml');
    // Req 13.8: both placeholders are replaced in one pass, so a path that holds the
    // text {report} is not rewritten a second time.
    const fill = (a) => a.replace(/\{(file|report)\}/g, (_, key) => (key === 'file' ? absPath : report));
    const args = splitCommand(command).map(fill);
    const { res, timedOut, limitMs } = spawnLimited(args[0], args.slice(1), {
      cwd,
      env: { ...env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: pycache },
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    if (timedOut) return { reason: timeoutReason(`The command for ${file}`, limitMs) };
    if (res.error) {
      return { reason: `The command for ${file} could not start (${res.error.code || res.error.message}). Check the command in runners.json.` };
    }
    if (res.status !== 0) {
      const how = res.status === null ? `was stopped by signal ${res.signal}` : `exited with status ${res.status}`;
      const reason = `The command for ${file} ${how}, so the file counts as failing whatever its report says. Fix the failing contracts, or the command in runners.json.`;
      const read = readCases(report, file);
      return read.cases ? { cases: read.cases, reason } : { reason };
    }
    return readCases(report, file);
  } catch (e) {
    return { reason: `The command for ${file} could not run. ${e.message}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (pycache !== null) fs.rmSync(pycache, { recursive: true, force: true });
  }
}
