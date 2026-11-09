// Contracts for Requirements 13.7 to 13.10 of the necro-core spec: hardening of runner contracts after an independent
// review got a tick on wrong code five ways. R13.7 a non-zero exit and a time limit, R13.8 one-pass placeholders and a
// fresh bytecode folder, R13.9 the reserved keys "sources" and "frozen" of runners.json, R13.10 the README limits.
//
// Each test builds a throwaway project in a temp directory and runs the tool there, the way Kiro does: `necro freeze`,
// `necro check`, `necro verify`, and `necro hook pre|post` with a JSON payload on stdin. The test framework of the
// contracts is a tiny fake written in Node and carried in this file (`FAKE_RUNNER`), so no Python or other tool is
// needed and no test here skips. It reads a contract file with one line per testcase ("pass <name>", "fail <name>",
// "error <name>", "skip <name>") and writes a JUnit XML report to the path it is given. Lines starting with "@" make it
// exit with a status, wait, start a child process that stays alive, or print text.
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files these tests exercise. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/runners.js'
//   from '../../src/junit.js'
//   from '../../src/contracts.js'
//   from '../../src/lock.js'
//   from '../../src/hooks.js'
//   from '../../src/check.js'
//   from '../../src/verify.js'
//   from '../../src/receipts.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

const FAKE_RUNNER = `'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [file, report] = process.argv.slice(2);
function listing(dir) {
  try { return fs.readdirSync(dir); } catch { return null; }
}
if (process.env.FAKE_RUNNER_LOG) {
  fs.appendFileSync(process.env.FAKE_RUNNER_LOG, JSON.stringify({
    file, report, argv: process.argv.slice(2),
    pycachePrefix: process.env.PYTHONPYCACHEPREFIX ?? null,
    pycacheEntries: listing(process.env.PYTHONPYCACHEPREFIX),
    dontWriteBytecode: process.env.PYTHONDONTWRITEBYTECODE ?? null,
  }) + '\\n');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let cases = '';
let exitCode = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = space < 0 ? line : line.slice(0, space);
  const rest = space < 0 ? '' : line.slice(space + 1);
  if (kind === '@print') console.log(rest);
  else if (kind === '@exit') exitCode = Number(rest);
  else if (kind === '@sleep') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(rest));
  else if (kind === '@child') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(rest, String(child.pid));
  }
  else if (kind === 'pass') cases += '<testcase classname="fake" name="' + esc(rest) + '"/>';
  else if (kind === 'fail') cases += '<testcase classname="fake" name="' + esc(rest) + '"><failure message="failed">x</failure></testcase>';
  else if (kind === 'error') cases += '<testcase classname="fake" name="' + esc(rest) + '"><error message="error">x</error></testcase>';
  else if (kind === 'skip') cases += '<testcase classname="fake" name="' + esc(rest) + '"><skipped message="skipped"/></testcase>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
process.exit(exitCode);
`;

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  delete env.NECRO_RUNNER_TIMEOUT_MS;
  return { ...env, ...extra };
}

function necro(cwd, args, input, extraEnv) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(extraEnv) });
}

function hook(cwd, which, toolName, toolInput) {
  const payload = {
    session_id: 's-contract',
    hook_event_name: which === 'pre' ? 'PreToolUse' : 'PostToolUse',
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
  };
  return necro(cwd, ['hook', which], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-hardening-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function sha(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function lockOf(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
}

function freeze(cwd) {
  const res = necro(cwd, ['freeze', 'demo']);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
  return res;
}

function calls(log) {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitUntilDead(pid, ms = 4000) {
  const end = Date.now() + ms;
  while (isAlive(pid) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  return !isAlive(pid);
}

const RUNNERS_REL = '.kiro/specs/demo/runners.json';
const FAKE_REL = 'tools/fake-runner.cjs';

function fakeCommand(cwd, tool = path.join(cwd, FAKE_REL)) {
  return `"${process.execPath}" "${tool}" {file} {report}`;
}

// A spec `demo` with the given contract files in contracts/demo/ and a runners.json where `*_contract.fake` runs the
// fake framework; `extra` adds more keys to runners.json (for example "sources" and "frozen").
function project(cwd, files, extra = {}, tool = path.join(cwd, FAKE_REL)) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
  put(tool.startsWith(cwd) ? cwd : path.dirname(tool), tool.startsWith(cwd) ? path.relative(cwd, tool) : path.basename(tool), FAKE_RUNNER);
  put(cwd, RUNNERS_REL, JSON.stringify({ '*_contract.fake': fakeCommand(cwd, tool), ...extra }, null, 2) + '\n');
  for (const [name, text] of Object.entries(files)) put(cwd, `contracts/demo/${name}`, text);
}

// Swap in new text for a contract file after the freeze and tell the lock its new hash, so the file runs and only the
// behavior of the command is under test.
function replaceAfterFreeze(cwd, rel, text) {
  put(cwd, rel, text);
  const lock = lockOf(cwd);
  for (const c of lock.specs.demo.contracts) if (c.path === rel) c.sha256 = sha(fs.readFileSync(path.join(cwd, rel)));
  fs.writeFileSync(path.join(cwd, '.necro', 'lock.json'), JSON.stringify(lock, null, 2) + '\n');
}

// --- R13.7 -------------------------------------------------------------------------------------------------------

test('R13.7 a runner command that exits with a non-zero status fails the file even when its report says every testcase passed', () =>
  temp((cwd) => {
    project(cwd, {
      'a_contract.fake': 'pass R1.1 add\npass R1.2 sub\n@exit 1\n',
      'b_contract.fake': 'pass R2.1 clean\n',
    });
    freeze(cwd);
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const lines = res.stdout.split('\n');
    assert.ok(lines.includes('fail R1.1 add'), res.stdout);
    assert.ok(lines.includes('fail R1.2 sub'), res.stdout);
    assert.ok(lines.includes('pass R2.1 clean'), 'a file that exits 0 is judged by its report');
    assert.match(res.stdout, /a_contract\.fake[^\n]*status 1\b/, 'the reason names the file and the exit status');
  }));

test('R13.7 a non-zero exit with no readable report is one failing contract named after the file, with the status named', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' });
    freeze(cwd);
    // The command is changed to one that exits 3 without writing a report, and the lock is told the new hash of runners.json,
    // so the command runs and only the exit status decides.
    put(cwd, RUNNERS_REL, JSON.stringify({ '*_contract.fake': `"${process.execPath}" -e "process.exit(3)" {file} {report}` }) + '\n');
    const lock = lockOf(cwd);
    lock.specs.demo.runners.sha256 = sha(fs.readFileSync(path.join(cwd, RUNNERS_REL)));
    fs.writeFileSync(path.join(cwd, '.necro', 'lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /a_contract\.fake[^\n]*status 3\b/);
    assert.ok(!res.stdout.split('\n').includes('pass R1.1 add'));
  }));

test('R13.7 a runner command that runs past the time limit fails the file with the timeout named, is killed with its children, and leaves no temporary folder', () =>
  temp((cwd) => {
    const pidFile = path.join(cwd, 'child.pid');
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' });
    freeze(cwd);
    replaceAfterFreeze(cwd, 'contracts/demo/a_contract.fake', `pass R1.1 add\n@child ${pidFile}\n@sleep 60000\n`);

    const log = path.join(cwd, 'calls.log');
    const started = Date.now();
    const res = necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log, NECRO_RUNNER_TIMEOUT_MS: '2000' });
    assert.ok(Date.now() - started < 30000, 'the hang was cut off');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /a_contract\.fake[^\n]*time limit/);
    assert.ok(!res.stdout.split('\n').includes('pass R1.1 add'), 'a run that was stopped does not pass');

    const [c] = calls(log);
    assert.ok(!fs.existsSync(path.dirname(c.report)), 'the temporary folder of the run is removed');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(childPid > 0);
    assert.ok(waitUntilDead(childPid), 'the child process of the command is killed');
  }));

test('R13.7 the runner time limit is 240 seconds by default, below the hooks limit of 300, and the same limit applies to JavaScript contract files', async () => {
  const { RUNNER_TIME_LIMIT_MS } = await import('../../src/runners.js');
  assert.equal(RUNNER_TIME_LIMIT_MS, 240000);
  assert.ok(RUNNER_TIME_LIMIT_MS < 300 * 1000);

  temp((cwd) => {
    const pidFile = path.join(cwd, 'js.pid');
    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    const body = `import { test } from 'node:test';
import fs from 'node:fs';
test('R1.1 hangs', async () => {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 9000));
});
`;
    put(cwd, 'contracts/demo/hang.contract.test.js', body);
    // Freeze would wait for the contract, so the lock is written with the contract's name by hand.
    put(
      cwd,
      '.necro/lock.json',
      JSON.stringify({
        specs: {
          demo: {
            requirements: { path: '.kiro/specs/demo/requirements.md', sha256: sha(fs.readFileSync(path.join(cwd, '.kiro/specs/demo/requirements.md'))) },
            contracts: [{ name: 'hang', path: 'contracts/demo/hang.contract.test.js', sha256: sha(body), names: ['R1.1 hangs'] }],
            tasks: {},
          },
        },
      }) + '\n',
    );
    const started = Date.now();
    const res = necro(cwd, ['check', 'demo'], undefined, { NECRO_RUNNER_TIMEOUT_MS: '2500' });
    assert.ok(Date.now() - started < 8500, 'cut off before the contract would have finished');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /hang\.contract\.test\.js[^\n]*time limit/);
    assert.ok(waitUntilDead(Number(fs.readFileSync(pidFile, 'utf8'))), 'the process of the contract file is killed');
  });
});

// --- R13.8 -------------------------------------------------------------------------------------------------------

test('R13.8 {file} and {report} are replaced in one pass, so a project path that holds {report} or {file} stays intact', () =>
  temp((parent) => {
    const cwd = path.join(parent, 'x{report}y {file}z');
    // The framework is kept outside the project: its own path is part of the command and is not a place for placeholders.
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' }, {}, path.join(parent, 'fake-runner.cjs'));
    const log = path.join(parent, 'calls.log');
    freeze(cwd);
    const res = necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.split('\n').includes('pass R1.1 add'));
    const [c] = calls(log);
    assert.equal(c.argv.length, 2, 'the command got exactly {file} and {report}');
    assert.ok(c.file.endsWith('x{report}y {file}z/contracts/demo/a_contract.fake'), c.file);
    assert.ok(!c.report.includes('x{report}y'), 'the report path is not made from the project path');
  }));

test('R13.8 a runner command gets a fresh empty PYTHONPYCACHEPREFIX folder each run, and PYTHONDONTWRITEBYTECODE=1', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' });
    const log = path.join(cwd, 'calls.log');
    freeze(cwd);
    necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log });
    // The environment of the tool does not decide it: an older value is replaced.
    necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log, PYTHONPYCACHEPREFIX: '/tmp/stale-cache', PYTHONDONTWRITEBYTECODE: '' });
    const seen = calls(log).slice(-2);
    assert.equal(seen.length, 2);
    const root = fs.realpathSync(cwd);
    for (const c of seen) {
      assert.equal(c.dontWriteBytecode, '1');
      assert.ok(typeof c.pycachePrefix === 'string' && path.isAbsolute(c.pycachePrefix) && c.pycachePrefix !== '/tmp/stale-cache');
      assert.deepEqual(c.pycacheEntries, [], 'the folder is empty when the command starts');
      assert.ok(path.relative(root, c.pycachePrefix).startsWith('..'), 'the folder is not in the project');
      assert.ok(!fs.existsSync(c.pycachePrefix), 'the folder is removed after the run');
    }
    assert.notEqual(seen[0].pycachePrefix, seen[1].pycachePrefix, 'a new folder for each run');
  }));

// --- R13.9 -------------------------------------------------------------------------------------------------------

test('R13.9 the globs under "sources" are pinned in the receipt, and necro verify prints MISMATCH when one of the files changes', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' }, { sources: ['app/*.txt'] });
    put(cwd, 'app/calc.txt', 'one\n');
    put(cwd, 'app/more.txt', 'two\n');
    put(cwd, 'app/skip.md', 'not matched\n');
    freeze(cwd);
    const checked = necro(cwd, ['check', 'demo']);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8'));
    assert.deepEqual(receipt.sources, [
      { path: 'app/calc.txt', sha256: sha('one\n') },
      { path: 'app/more.txt', sha256: sha('two\n') },
    ]);
    assert.match(necro(cwd, ['verify', receiptPath]).stdout, /CONFIRMED/);
    put(cwd, 'app/more.txt', 'changed\n');
    const bad = necro(cwd, ['verify', receiptPath]);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MISMATCH/);
    assert.match(bad.stdout, /app\/more\.txt/);
  }));

test('R13.9 the files under "frozen" are locked with the spec: the gate refuses edits and puts them back, check fails while one differs, receipts pin them', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' }, { frozen: ['conftest.txt', 'pytest.txt'] });
    put(cwd, 'conftest.txt', 'plugin-free\n');
    put(cwd, 'pytest.txt', 'ini-free\n');
    freeze(cwd);

    // The lock holds them by hash, and a copy of each is stored.
    const entry = lockOf(cwd).specs.demo;
    assert.deepEqual(entry.frozen, [
      { path: 'conftest.txt', sha256: sha('plugin-free\n') },
      { path: 'pytest.txt', sha256: sha('ini-free\n') },
    ]);
    assert.equal(fs.readFileSync(path.join(cwd, '.necro', 'frozen', sha('plugin-free\n')), 'utf8'), 'plugin-free\n');

    // The receipt pins them.
    const checked = necro(cwd, ['check', 'demo']);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8'));
    assert.deepEqual(receipt.frozen, entry.frozen);

    // PreToolUse refuses a write to a frozen file.
    const refused = hook(cwd, 'pre', 'fs_write', { path: path.join(cwd, 'conftest.txt'), text: 'plugin\n' });
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /conftest\.txt/);

    // PostToolUse puts back a file a shell command changed or removed.
    hook(cwd, 'pre', 'execute_bash', { command: 'echo plugin > conftest.txt; rm pytest.txt' });
    fs.writeFileSync(path.join(cwd, 'conftest.txt'), 'plugin\n');
    fs.rmSync(path.join(cwd, 'pytest.txt'));
    const restored = hook(cwd, 'post', 'execute_bash', { command: 'x' });
    assert.match(restored.stderr, /Restored frozen file conftest\.txt/);
    assert.match(restored.stderr, /Restored frozen file pytest\.txt/);
    assert.equal(fs.readFileSync(path.join(cwd, 'conftest.txt'), 'utf8'), 'plugin-free\n');

    // While a frozen file differs from the lock, the runner files fail and the command does not run.
    const log = path.join(cwd, 'calls.log');
    put(cwd, 'conftest.txt', 'plugin\n');
    const failing = necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log });
    assert.equal(failing.status, 1);
    assert.ok(failing.stdout.split('\n').includes('fail R1.1 add'), failing.stdout);
    assert.match(failing.stdout, /conftest\.txt/);
    assert.equal(calls(log).length, 0, 'the command did not run');

    // necro verify of the earlier receipt prints MISMATCH naming the file.
    const bad = necro(cwd, ['verify', receiptPath]);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MISMATCH/);
    assert.match(bad.stdout, /conftest\.txt/);
  }));

test('R13.9 a spec whose runners.json has neither key gets a lock and receipts without "frozen" and with no sources', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' });
    freeze(cwd);
    assert.equal(Object.hasOwn(lockOf(cwd).specs.demo, 'frozen'), false);
    const checked = necro(cwd, ['check', 'demo']);
    const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8')), 'frozen'), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8')).sources, []);
  }));

test('R13.9 a glob under "frozen" or "sources" that matches no file refuses the freeze with a plain sentence', () => {
  for (const key of ['frozen', 'sources']) {
    temp((cwd) => {
      project(cwd, { 'a_contract.fake': 'pass R1.1 add\n' }, { [key]: ['conftest.missing'] });
      const res = necro(cwd, ['freeze', 'demo']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /conftest\.missing/);
      assert.match(res.stderr + res.stdout, /runners\.json/);
    });
  }
});

// --- R13.10 ------------------------------------------------------------------------------------------------------

test('R13.10 the README says plainly what runner contracts cannot defend against', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /What runner contracts cannot defend against/);
  assert.match(readme, /Code under test runs inside the test framework's own process/);
  assert.match(readme, /can tamper with (?:that process|it)/);
  assert.match(readme, /trusts the language environment/);
  assert.match(readme, /installed packages/);
  assert.match(readme, /the interpreter/);
});
