// Contracts for Requirement 13 (contracts in any language) of the necro-core spec.
// R13.1, R13.2, R13.3, R13.4, R13.5. R13.6 (the Python example) is a separate file.
//
// Each test builds a throwaway project in a temp directory and runs the tool there, the way Kiro does: `necro freeze`,
// `necro check`, `necro verify`, and `necro hook pre|post` with a JSON payload on stdin. The test framework of the
// contracts is a tiny fake written in Node and carried in this file (`FAKE_RUNNER`), so no Python or other tool is
// needed. It reads a contract file with one line per testcase ("pass <name>", "fail <name>", "error <name>",
// "skip <name>") and writes a JUnit XML report to the path it is given. Lines starting with "@" make it print text,
// write no report, write broken XML or an empty report.
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
const path = require('node:path');
const [file, report] = process.argv.slice(2);
if (process.env.FAKE_RUNNER_LOG) {
  let dirEntries = null;
  let dirReal = null;
  try { dirEntries = fs.readdirSync(path.dirname(report)); } catch { dirEntries = null; }
  try { dirReal = fs.realpathSync(path.dirname(report)); } catch { dirReal = null; }
  fs.appendFileSync(process.env.FAKE_RUNNER_LOG, JSON.stringify({
    file, report, argv: process.argv.slice(2), cwd: process.cwd(),
    reportExisted: fs.existsSync(report), dirEntries, dirReal,
  }) + '\\n');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let cases = '';
let mode = 'normal';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = space < 0 ? line : line.slice(0, space);
  const rest = space < 0 ? '' : line.slice(space + 1);
  if (kind === '@print') console.log(rest);
  else if (kind === '@no-report') mode = 'none';
  else if (kind === '@bad-xml') mode = 'bad';
  else if (kind === '@empty') mode = 'empty';
  else if (kind === 'pass') cases += '<testcase classname="fake" name="' + esc(rest) + '"/>';
  else if (kind === 'fail') cases += '<testcase classname="fake" name="' + esc(rest) + '"><failure message="failed">x</failure></testcase>';
  else if (kind === 'error') cases += '<testcase classname="fake" name="' + esc(rest) + '"><error message="error">x</error></testcase>';
  else if (kind === 'skip') cases += '<testcase classname="fake" name="' + esc(rest) + '"><skipped message="skipped"/></testcase>';
}
if (mode === 'bad') fs.writeFileSync(report, '<testsuite><testcase name="R1.1 half">');
else if (mode === 'empty') fs.writeFileSync(report, '<testsuite tests="0"></testsuite>');
else if (mode !== 'none') fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-runners-'));
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

function receipts(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
}

const RUNNERS_REL = '.kiro/specs/demo/runners.json';
const TASKS_REL = '.kiro/specs/demo/tasks.md';
const FAKE_REL = 'tools/fake-runner.cjs';

const TASK_ONE = '1. First (Req 1.1)';
const TASK_TWO = '2. Second (Req 2.1)';
const TASK_THREE = '3. Third (Req 3.1)';
const TASKS = [TASK_ONE, TASK_TWO, TASK_THREE].map((t) => `- [ ] ${t}`).join('\n') + '\n';

const JS_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R3.1 js contract', () => { assert.ok(true); });
`;

// The runners.json of a project: the pattern `*_contract.fake` runs the fake framework.
function runnersJson(command) {
  return JSON.stringify({ '*_contract.fake': command }, null, 2) + '\n';
}

function fakeCommand(cwd) {
  return `"${process.execPath}" "${path.join(cwd, FAKE_REL)}" {file} {report}`;
}

// A spec `demo` with the given contract files in contracts/demo/, a runners.json (by default `*_contract.fake` runs
// the fake framework), and tasks.md.
function project(cwd, files, runners = runnersJson(fakeCommand(cwd))) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
  put(cwd, TASKS_REL, TASKS);
  put(cwd, FAKE_REL, FAKE_RUNNER);
  put(cwd, RUNNERS_REL, runners);
  for (const [name, text] of Object.entries(files)) put(cwd, `contracts/demo/${name}`, text);
}

function taskUpdate(cwd, taskId) {
  return { tasksFilePath: path.join(cwd, TASKS_REL), status: 'completed', taskId, error: '' };
}

test('R13.1 files matching a pattern in runners.json are contract files of the spec in freeze, check, the gate and verify', () =>
  temp((cwd) => {
    project(cwd, {
      'a_contract.fake': 'pass R1.1 first thing\npass R2.1 second thing\n',
      'js.contract.test.js': JS_CONTRACT,
      'notes.txt': 'fail R9.9 not a contract\n',
    });

    // freeze: the matching file and the JavaScript file are locked, with their names; the other file is not.
    freeze(cwd);
    const entry = lockOf(cwd).specs.demo;
    assert.deepEqual(entry.contracts.map((c) => c.path).sort(), ['contracts/demo/a_contract.fake', 'contracts/demo/js.contract.test.js']);
    const fake = entry.contracts.find((c) => c.path === 'contracts/demo/a_contract.fake');
    assert.equal(fake.sha256, sha(fs.readFileSync(path.join(cwd, 'contracts/demo/a_contract.fake'))));
    assert.deepEqual(fake.names, ['R1.1 first thing', 'R2.1 second thing']);
    assert.ok(!JSON.stringify(entry).includes('notes.txt'), 'a file that matches no pattern is not locked');

    // check: every contract of the matching file runs and is printed by name, and the receipt holds them.
    const checked = necro(cwd, ['check', 'demo']);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    for (const name of ['R1.1 first thing', 'R2.1 second thing', 'R3.1 js contract']) {
      assert.ok(checked.stdout.split('\n').includes(`pass ${name}`), `missing "pass ${name}" in:\n${checked.stdout}`);
    }
    const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8'));
    assert.deepEqual(
      written.contracts.filter((c) => c.path === 'contracts/demo/a_contract.fake').map((c) => [c.name, c.result]),
      [['R1.1 first thing', 'pass'], ['R2.1 second thing', 'pass']],
    );
    assert.equal(written.task, null);

    // the gate: a tick runs the matching file and writes a receipt for that task.
    const gate = hook(cwd, 'pre', 'task_update', taskUpdate(cwd, TASK_ONE));
    assert.equal(gate.status, 0, gate.stderr);
    const gateReceipt = receipts(cwd).find((r) => r.task && r.task.id === '1');
    assert.ok(gateReceipt, 'the gate wrote a receipt for task 1');
    assert.ok(gateReceipt.contracts.some((c) => c.path === 'contracts/demo/a_contract.fake' && c.result === 'pass'));

    // verify: the receipt is confirmed, then it is a MISMATCH once the contract file changed.
    const confirmed = necro(cwd, ['verify', receiptPath]);
    assert.equal(confirmed.status, 0, confirmed.stdout + confirmed.stderr);
    assert.match(confirmed.stdout, /CONFIRMED/);
    put(cwd, 'contracts/demo/a_contract.fake', 'fail R1.1 first thing\npass R2.1 second thing\n');
    const mismatch = necro(cwd, ['verify', receiptPath]);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /MISMATCH/);
    assert.match(mismatch.stdout, /a_contract\.fake/);
  }));

test('R13.2 a contract file runs its command without a shell, with {file} and a new {report} path, and results come only from the report', () =>
  temp((cwd) => {
    const marker = path.join(cwd, 'shell-ran');
    const command = `${fakeCommand(cwd)} ; touch ${marker} && echo hi > ${marker} $(touch ${marker}) | cat`;
    project(
      cwd,
      {
        'a_contract.fake':
          '@print ok 1 - R1.1 printed pass\n@print # pass 4\nfail R1.1 printed pass\nerror R1.2 errors\nskip R1.3 skipped\npass R1.4 clean\n',
      },
      runnersJson(command),
    );
    const log = path.join(cwd, 'calls.log');
    freeze(cwd);

    const first = necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log });
    assert.equal(first.status, 1, 'failing, erroring and skipped testcases are not passes');
    const lines = first.stdout.split('\n');
    assert.ok(lines.includes('fail R1.1 printed pass'), first.stdout);
    assert.ok(lines.includes('fail R1.2 errors'), first.stdout);
    assert.ok(lines.includes('fail R1.3 skipped'), first.stdout);
    assert.ok(lines.includes('pass R1.4 clean'), first.stdout);
    assert.ok(!lines.includes('pass R1.1 printed pass'), 'printed text is not a result');

    // No shell ran the rest of the line: the operators reached the program as arguments.
    assert.ok(!fs.existsSync(marker), 'a shell ran part of the command');

    // A second run, to compare the report paths.
    necro(cwd, ['check', 'demo'], undefined, { FAKE_RUNNER_LOG: log });
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(calls.length, 2);
    const tmp = fs.realpathSync(os.tmpdir());
    const root = fs.realpathSync(cwd);
    for (const c of calls) {
      assert.equal(fs.realpathSync(c.file), path.join(root, 'contracts/demo/a_contract.fake'), '{file} is the contract file');
      assert.ok(c.argv.includes(';') && c.argv.includes('&&') && c.argv.includes('|'), 'operators are plain arguments');
      assert.ok(path.isAbsolute(c.report));
      assert.ok(!path.relative(tmp, c.dirReal).startsWith('..'), `the report folder is a temporary folder: ${c.dirReal}`);
      assert.ok(path.relative(root, c.dirReal).startsWith('..'), 'the report is not in the project');
      assert.equal(c.reportExisted, false, 'the report path is new');
      assert.deepEqual(c.dirEntries, [], 'the report folder is fresh and empty');
    }
    assert.notEqual(calls[0].report, calls[1].report, 'each run gets a new report path');
  }));

test('R13.3 testcase names are contract names, and the gate requires the contracts of the ticked task by criterion', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 first thing\nfail R2.1 second thing\npass R3.1 third thing\n' });
    freeze(cwd);
    assert.deepEqual(lockOf(cwd).specs.demo.tasks['2'].criteria, ['2.1']);

    const refused = hook(cwd, 'pre', 'task_update', taskUpdate(cwd, TASK_TWO));
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /R2\.1 second thing/);
    assert.doesNotMatch(refused.stderr, /R1\.1 first thing|R3\.1 third thing/, 'only the failing contract is named');
    assert.equal(receipts(cwd).length, 0, 'no receipt for a refused tick');

    const accepted = hook(cwd, 'pre', 'task_update', taskUpdate(cwd, TASK_ONE));
    assert.equal(accepted.status, 0, accepted.stderr);
    const [receipt] = receipts(cwd);
    assert.deepEqual(receipt.required, ['R1.1 first thing']);
    assert.deepEqual(receipt.task, { id: '1', line: TASK_ONE });
    assert.deepEqual(
      Object.fromEntries(receipt.contracts.map((c) => [c.name, c.result])),
      { 'R1.1 first thing': 'pass', 'R2.1 second thing': 'fail', 'R3.1 third thing': 'pass' },
      'every contract that ran is recorded',
    );
  }));

test('R13.4 a missing command, no report, bad XML and an empty report each fail the file, with the file named', () => {
  const cases = {
    'a command that cannot start': { command: '/no/such/program-for-necro {file} {report}', file: 'pass R5.1 x\n' },
    'a command that writes no report': { file: '@no-report\npass R5.1 x\n' },
    'XML that does not parse': { file: '@bad-xml\npass R5.1 x\n' },
    'a report with no testcase': { file: '@empty\n' },
  };
  for (const [label, { command, file }] of Object.entries(cases)) {
    temp((cwd) => {
      // a_contract.fake is the broken file; b_contract.fake always works.
      const runners = JSON.stringify({ 'a_*.fake': command || fakeCommand(cwd), 'b_*.fake': fakeCommand(cwd) }, null, 2) + '\n';
      project(cwd, { 'a_contract.fake': file, 'b_contract.fake': 'pass R1.1 fine\n' }, runners);
      freeze(cwd);

      const checked = necro(cwd, ['check', 'demo']);
      assert.equal(checked.status, 1, `${label}: check must fail\n${checked.stdout}`);
      assert.match(checked.stdout, /a_contract\.fake/, `${label}: the file is named`);
      assert.ok(!checked.stdout.split('\n').some((l) => l.startsWith('pass ') && l.includes('a_contract')), `${label}: never a pass`);
      assert.ok(checked.stdout.split('\n').includes('pass R1.1 fine'), `${label}: the other file still runs`);

      const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
      const written = JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8'));
      const ofFile = written.contracts.filter((c) => c.path === 'contracts/demo/a_contract.fake');
      assert.ok(ofFile.length >= 1 && ofFile.every((c) => c.result === 'fail'), `${label}: the receipt records only failures for the file`);

      // The gate, with a task no contract names, so every contract is required.
      const gate = hook(cwd, 'pre', 'task_update', taskUpdate(cwd, TASK_THREE));
      assert.equal(gate.status, 2, `${label}: the gate refuses`);
      assert.match(gate.stderr, /a_contract\.fake/, `${label}: the gate names the file`);
    });
  }
});

test('R13.5 runners.json is locked by hash with the spec, restored after an agent edit, and an edited one makes verify print MISMATCH', () =>
  temp((cwd) => {
    project(cwd, { 'a_contract.fake': 'pass R1.1 first thing\n', 'js.contract.test.js': JS_CONTRACT });
    const abs = path.join(cwd, RUNNERS_REL);
    const original = fs.readFileSync(abs);
    freeze(cwd);

    // Locked by hash, with a copy under .necro/frozen.
    const locked = JSON.stringify(lockOf(cwd).specs.demo);
    assert.ok(locked.includes(RUNNERS_REL), 'the lock names runners.json');
    assert.ok(locked.includes(sha(original)), 'the lock holds its SHA-256');
    assert.deepEqual(fs.readFileSync(path.join(cwd, '.necro', 'frozen', sha(original))), original);

    // PreToolUse refuses a write to it.
    const blocked = hook(cwd, 'pre', 'fs_write', { path: abs, text: '{}' });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /runners\.json/);
    assert.deepEqual(fs.readFileSync(abs), original);
    assert.equal(hook(cwd, 'pre', 'str_replace', { path: RUNNERS_REL, oldStr: 'fake', newStr: 'x' }).status, 2);

    // PostToolUse puts back an edit made by a shell command, and a deleted file.
    assert.equal(hook(cwd, 'pre', 'execute_bash', { command: 'echo editing' }).status, 0);
    fs.writeFileSync(abs, '{"*": "true"}\n');
    const restored = hook(cwd, 'post', 'execute_bash', { command: 'echo editing' });
    assert.match(restored.stderr, /runners\.json/);
    assert.deepEqual(fs.readFileSync(abs), original);
    assert.equal(hook(cwd, 'pre', 'execute_bash', { command: 'rm runners.json' }).status, 0);
    fs.rmSync(abs);
    assert.match(hook(cwd, 'post', 'execute_bash', { command: 'rm runners.json' }).stderr, /runners\.json/);
    assert.deepEqual(fs.readFileSync(abs), original);

    // verify: confirmed, then a MISMATCH naming runners.json once it differs from the receipt.
    const checked = necro(cwd, ['check', 'demo']);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const receiptPath = /Receipt: (\S+)/.exec(checked.stdout)[1];
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receiptPath), 'utf8'));
    assert.ok(JSON.stringify(written).includes(sha(original)), 'the receipt pins runners.json');
    assert.equal(necro(cwd, ['verify', receiptPath]).status, 0);

    fs.writeFileSync(abs, Buffer.concat([original, Buffer.from('\n')]));
    const mismatch = necro(cwd, ['verify', receiptPath]);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /MISMATCH/);
    assert.match(mismatch.stdout, /runners\.json/);
  }));
