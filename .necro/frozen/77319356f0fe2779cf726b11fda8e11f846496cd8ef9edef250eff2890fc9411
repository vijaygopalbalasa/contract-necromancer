// Contracts for Requirement 6.13 of the necro-core spec: `necro verify` tells a contract that cannot run apart from one
// that changed.
//
// R6.13  IF a contract cannot run because its runner is not installed (for example a Python contract when `pytest` is
//        not on PATH) or because a module it imports is not installed (Node `ERR_MODULE_NOT_FOUND`, Python
//        `ModuleNotFoundError`, for example a fresh clone before `npm ci`) THEN THE SYSTEM SHALL count that contract as
//        not run, never as changed, and IF every check that did run matches THEN print `INCOMPLETE` naming each
//        contract that did not run, what is missing (for example "pytest not found") and the usual fix (for example
//        "run npm ci"), and exit with code 2.
//
// R6.16  WHEN `necro check` or the gate's hooks (PreToolUse, PostToolUse, Stop, PostTaskExec and the IDE `task_update`
//        call) run a spec's contracts AND a contract cannot run for the reasons in 6.13 (runner not installed,
//        imported module not installed) THEN THE SYSTEM SHALL count that contract as failing, refuse the tick, and
//        name what is missing; only `necro verify` reports a contract as not run, so removing a dependency never
//        becomes a way past the gate.
//
// Each test builds a throwaway project in a temp directory. The spec has a Node contract and a "Python" contract run by
// a command called `pytest`. That command is a small fake found through PATH (a shell script that starts a Node script
// writing a JUnit report), so no Python is needed. The project is frozen and checked with the fake on PATH. `necro
// verify` then runs with a PATH that holds no `pytest`, the way a machine without it looks. This file carries its own
// helpers.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
//   from '../../src/runners.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

const FAKE_PYTEST = `'use strict';
const fs = require('node:fs');
const [file, report] = process.argv.slice(2);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let cases = '';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = line.slice(0, space);
  const name = line.slice(space + 1);
  if (kind === 'pass') cases += '<testcase classname="fake" name="' + esc(name) + '"/>';
  else if (kind === 'fail') cases += '<testcase classname="fake" name="' + esc(name) + '"><failure message="failed">x</failure></testcase>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return { ...env, ...extra };
}

function necro(cwd, args, extraEnv) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv(extraEnv) });
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// A temp folder, a folder with a working fake `pytest`, and an empty folder to use as a PATH without one.
function temp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-incomplete-'));
  try {
    const cwd = path.join(root, 'project');
    fs.mkdirSync(cwd);
    const withPytest = path.join(root, 'with-pytest');
    const without = path.join(root, 'empty');
    fs.mkdirSync(withPytest);
    fs.mkdirSync(without);
    fs.writeFileSync(path.join(withPytest, 'fake-pytest.cjs'), FAKE_PYTEST);
    const exe = path.join(withPytest, 'pytest');
    fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(withPytest, 'fake-pytest.cjs')}" "$@"\n`);
    fs.chmodSync(exe, 0o755);
    return fn(cwd, { WITH: { PATH: `${withPytest}:/usr/bin:/bin` }, WITHOUT: { PATH: without } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const PY_NAME = 'R6.13 python criterion holds';
const JS_NAME = 'R6.13 node criterion holds';

// Freeze a spec `demo` with a Node contract and a contract run by `pytest`, then make its receipt with pytest present.
function frozenProject(cwd, env) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, '.kiro/specs/demo/runners.json', JSON.stringify({ 'test_*.py': 'pytest {file} {report}' }) + '\n');
  put(
    cwd,
    'contracts/demo/a.contract.test.js',
    `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${JS_NAME}', () => { assert.ok(true); });\n`,
  );
  put(cwd, 'contracts/demo/test_a.py', `pass ${PY_NAME}\n`);
  const frozen = necro(cwd, ['freeze', 'demo'], env.WITH);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo'], env.WITH);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}`);
  return found[1];
}

test('R6.13 verify prints INCOMPLETE naming the contract that did not run and "pytest not found", exits 2, and never prints MISMATCH when only the runner is missing', () =>
  temp((cwd, env) => {
    const rel = frozenProject(cwd, env);
    const ok = necro(cwd, ['verify', rel], env.WITH);
    assert.equal(ok.status, 0, `with pytest the receipt is confirmed: ${ok.stdout}${ok.stderr}`);

    const res = necro(cwd, ['verify', rel], env.WITHOUT);
    assert.equal(res.status, 2, `exit code 2: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /INCOMPLETE/);
    assert.ok(res.stdout.includes(PY_NAME), `names the contract that did not run: ${res.stdout}`);
    assert.match(res.stdout, /pytest not found/);
    assert.match(res.stdout, /install pytest/, `gives the usual fix: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
  }));

test('R6.13 a contract that did run is not named as not run (only the pytest contract is listed)', () =>
  temp((cwd, env) => {
    const rel = frozenProject(cwd, env);
    const res = necro(cwd, ['verify', rel], env.WITHOUT);
    assert.equal(res.status, 2, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /INCOMPLETE/);
    assert.ok(!res.stdout.includes(JS_NAME), `the Node contract ran, so it is not listed: ${res.stdout}`);
  }));

test('R6.13 a real change still prints MISMATCH and exits 1 when the runner is missing too', () =>
  temp((cwd, env) => {
    const rel = frozenProject(cwd, env);
    // The Node contract file changes after the freeze: that is a change, whatever the missing runner means.
    put(
      cwd,
      'contracts/demo/a.contract.test.js',
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${JS_NAME}', () => { assert.ok(1 === 1); });\n`,
    );
    const res = necro(cwd, ['verify', rel], env.WITHOUT);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /a\.contract\.test\.js/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE/);
  }));

// A Node project whose only contract imports a package that lives in node_modules. The package is written, the spec is
// frozen and checked, so the receipt exists; the tests then remove or restore node_modules.
const PKG = 'necro-fake-dep';
const DEP_NAME = 'R6.13 node contract needs an installed package';
const DEP_SOURCE = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '${PKG}';\ntest('${DEP_NAME}', () => { assert.equal(value, 1); });\n`;

function installPackage(cwd) {
  put(cwd, `node_modules/${PKG}/package.json`, JSON.stringify({ name: PKG, version: '1.0.0', type: 'module', main: 'index.js' }) + '\n');
  put(cwd, `node_modules/${PKG}/index.js`, 'export const value = 1;\n');
}

function removePackages(cwd) {
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true, force: true });
}

function frozenNodeProject(cwd) {
  installPackage(cwd);
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/dep.contract.test.js', DEP_SOURCE);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo']);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}`);
  return found[1];
}

test('R6.13 a Node contract whose imported package is not installed prints INCOMPLETE naming the contract, saying the package is not found and "run npm ci", exits 2 and never prints MISMATCH', () =>
  temp((cwd) => {
    const rel = frozenNodeProject(cwd);
    removePackages(cwd);
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 2, `exit code 2: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /INCOMPLETE/);
    assert.ok(res.stdout.includes(DEP_NAME), `names the contract that did not run: ${res.stdout}`);
    assert.ok(res.stdout.includes(`${PKG} not found`), `says which package is missing: ${res.stdout}`);
    assert.match(res.stdout, /run npm ci/, `gives the usual fix: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
  }));

test('R6.13 the same project prints CONFIRMED and exits 0 once the package exists again', () =>
  temp((cwd) => {
    const rel = frozenNodeProject(cwd);
    removePackages(cwd);
    const missing = necro(cwd, ['verify', rel]);
    assert.equal(missing.status, 2, `${missing.stdout}${missing.stderr}`);
    installPackage(cwd);
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /CONFIRMED/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE|MISMATCH/);
  }));

test('R6.13 a real change still prints MISMATCH and exits 1 when the imported package is missing too', () =>
  temp((cwd) => {
    const rel = frozenNodeProject(cwd);
    removePackages(cwd);
    // The contract file changes after the freeze: that is a change, whatever the missing package means.
    put(cwd, 'contracts/demo/dep.contract.test.js', `${DEP_SOURCE}// edited after the freeze\n`);
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /dep\.contract\.test\.js/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE/);
  }));

// -- Requirement 6.16: check and the gate count a contract that cannot run as failing ------------------------------------

const TASKS_REL = '.kiro/specs/demo/tasks.md';
const TASK_LINE = '1. Implement the demo (Req 6.16)';
const TASKS_OPEN = `- [ ] ${TASK_LINE}\n`;
const TASKS_TICKED = `- [x] ${TASK_LINE}\n`;

// The gate's PreToolUse hook, as the gate contracts call it.
function pre(cwd, toolName, toolInput, extraEnv) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return spawnSync(process.execPath, [BIN, 'hook', 'pre'], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: cleanEnv(extraEnv),
  });
}

const tickByEdit = (cwd, env) => pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' }, env);
const tickByTool = (cwd, env) =>
  pre(cwd, 'task_update', { tasksFilePath: path.join(cwd, TASKS_REL), taskId: TASK_LINE, status: 'completed', error: '' }, env);

function receiptFiles(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

// The tick is refused: exit 2, the contract that cannot run is named as failing, and what is missing is named.
function assertRefused(res, label, contractName, missing) {
  assert.equal(res.status, 2, `${label}: the gate refuses the tick (exit 2): ${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /Contracts failed:/, label);
  assert.ok(res.stderr.includes(contractName), `${label}: names the contract: ${res.stderr}`);
  assert.ok(res.stderr.includes(missing), `${label}: names what is missing (${missing}): ${res.stderr}`);
}

test('R6.16 with pytest missing the gate refuses a tick of tasks.md and a task_update to completed, names the contract and "pytest", and writes no receipt', () =>
  temp((cwd, env) => {
    put(cwd, TASKS_REL, TASKS_OPEN);
    frozenProject(cwd, env);

    // Guard: with pytest installed the same tick is allowed, so the refusal below is about the missing runner.
    const allowed = tickByEdit(cwd, env.WITH);
    assert.equal(allowed.status, 0, `with pytest the tick is allowed: ${allowed.stderr}`);
    fs.rmSync(path.join(cwd, '.necro', 'receipts'), { recursive: true, force: true });

    assertRefused(tickByEdit(cwd, env.WITHOUT), 'str_replace', PY_NAME, 'pytest');
    assertRefused(tickByTool(cwd, env.WITHOUT), 'task_update', PY_NAME, 'pytest');
    assert.deepEqual(receiptFiles(cwd), [], 'a refused tick writes no receipt');
  }));

test('R6.16 with an imported package missing the gate refuses a tick of tasks.md and a task_update to completed, names the contract and the package, and writes no receipt', () =>
  temp((cwd) => {
    put(cwd, TASKS_REL, TASKS_OPEN);
    frozenNodeProject(cwd);
    removePackages(cwd);
    fs.rmSync(path.join(cwd, '.necro', 'receipts'), { recursive: true, force: true });

    assertRefused(tickByEdit(cwd), 'str_replace', DEP_NAME, PKG);
    assertRefused(tickByTool(cwd), 'task_update', DEP_NAME, PKG);
    assert.deepEqual(receiptFiles(cwd), [], 'a refused tick writes no receipt');
  }));

test('R6.16 necro check exits 1 for a contract that cannot run, naming it as failing and what is missing', () =>
  temp((cwd, env) => {
    frozenProject(cwd, env);

    const noPytest = necro(cwd, ['check', 'demo'], env.WITHOUT);
    assert.equal(noPytest.status, 1, `check exits 1 with pytest missing: ${noPytest.stdout}${noPytest.stderr}`);
    assert.match(noPytest.stdout, new RegExp(`fail ${PY_NAME}`), `the contract counts as failing: ${noPytest.stdout}`);
    assert.match(noPytest.stdout, /pytest/, `names what is missing: ${noPytest.stdout}`);
    assert.doesNotMatch(noPytest.stdout, /All \d+ contracts pass/);
  }));

test('R6.16 necro check exits 1 for a Node contract whose imported package is missing, naming it as failing and the package', () =>
  temp((cwd) => {
    frozenNodeProject(cwd);
    removePackages(cwd);
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1, `check exits 1 with the package missing: ${res.stdout}${res.stderr}`);
    assert.ok(res.stdout.includes(PKG), `names the missing package: ${res.stdout}`);
    assert.match(res.stdout, /fail /, `the contract counts as failing: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /All \d+ contracts pass/);
  }));
