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

// Read the text of a runners.json into [{ pattern, command }] in file order.
// Throws an Error that names runners.json when the text is not a JSON object of
// file-name patterns (a name in contracts/<spec>/, with * and ?) to non-empty commands.
export function parseRunners(text) {
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
  for (const [pattern, command] of Object.entries(data)) {
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
  return patterns;
}

// Read a spec's runners.json from disk. Returns null when the file does not
// exist, otherwise { path, sha256, patterns }. Throws when it cannot be read or parsed.
export function readRunners(cwd, spec) {
  const rel = runnersRel(spec);
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(cwd, rel));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${rel}. Check that it is a file in the project.`);
  }
  return { path: rel, sha256: sha256(bytes), patterns: parseRunners(bytes.toString('utf8')) };
}

// The patterns of a runners.json pinned in the lock (`entry.runners`), or null when
// the file on disk is missing, differs from the pinned hash, or cannot be parsed.
// The bytes that are hashed are the bytes that are parsed.
export function lockedRunners(cwd, pinned) {
  if (!pinned || typeof pinned.path !== 'string' || typeof pinned.sha256 !== 'string') return null;
  let bytes;
  try {
    bytes = fs.readFileSync(path.resolve(cwd, pinned.path));
  } catch {
    return null;
  }
  if (sha256(bytes) !== pinned.sha256) return null;
  try {
    return parseRunners(bytes.toString('utf8'));
  } catch {
    return null;
  }
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

// Run one contract file with its command and read the JUnit XML report.
// Returns { cases: [{ name, outcome }] }, or { reason } (a plain sentence naming
// the file) when the command cannot start, writes no report, writes XML that does
// not parse, or writes a report with no testcase. `env` is the environment of the
// command. Nothing the command prints is read.
export function runReport(cwd, absPath, command, env) {
  const file = path.basename(absPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-report-'));
  const report = path.join(dir, 'report.xml');
  try {
    const args = splitCommand(command).map((a) => a.split('{file}').join(absPath).split('{report}').join(report));
    const res = spawnSync(args[0], args.slice(1), {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    if (res.error) {
      return { reason: `The command for ${file} could not start (${res.error.code || res.error.message}). Check the command in runners.json.` };
    }
    let xml;
    try {
      xml = fs.readFileSync(report, 'utf8');
    } catch {
      return { reason: `The command for ${file} wrote no report at {report}. Check that runners.json passes {report} to the test framework.` };
    }
    let cases;
    try {
      cases = parseJunit(xml);
    } catch (e) {
      return { reason: `The report for ${file} could not be read. ${e.message}` };
    }
    if (cases.length === 0) return { reason: `The report for ${file} holds no testcase, so no contract ran.` };
    return { cases };
  } catch (e) {
    return { reason: `The command for ${file} could not run. ${e.message}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
