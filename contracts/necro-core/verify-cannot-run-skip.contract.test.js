// Contracts for Requirement 6.17 of the necro-core spec: a Node contract that skips itself with `cannot run:` did not run.
//
// R6.17  IF a Node contract skips itself with a reason that starts with `cannot run:` (for example R13.6 when
//        `python3 -m pytest` is not available) THEN `necro verify` SHALL count that contract as not run, exactly as in
//        6.13, and name the rest of the reason as what is missing. `necro check`, `necro audit` and the gate's hooks
//        SHALL still count it as failing (4.7, 6.16) and print the reason. A skip with any other reason, or with none,
//        stays a failing contract everywhere, in verify too.
//
// Each test builds a throwaway project in a temp directory. The spec has one Node contract that skips itself when the
// file `skip.flag` exists, with the text of that file as the reason (an empty file skips with no reason). The flag is
// read at run time and is not imported, so the contract file keeps its hash. The project is frozen and checked with no
// flag, so the receipt records a pass. The flag is then written, the way a machine without a tool looks, and
// `necro verify`, `necro check`, `necro audit` and the gate's PreToolUse hook run. This file carries its own helpers.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
//   from '../../src/contracts.js'
//   from '../../src/check.js'
//   from '../../src/audit.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-cannot-run-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const NAME = 'R6.17 the helper tool is available';
const CONTRACT_REL = 'contracts/demo/tool.contract.test.js';
const TASKS_REL = '.kiro/specs/demo/tasks.md';
const TASK_LINE = '1. Use the helper tool (Req 6.17)';
const CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const flag = new URL('../../skip.flag', import.meta.url);
const reason = fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8').trim() : false;
test('${NAME}', { skip: reason === '' ? true : reason }, () => { assert.ok(true); });
`;

// A frozen spec with an open task, checked with no flag, so the receipt records a pass. Returns the receipt's path.
function frozenProject(cwd) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, TASKS_REL, `- [ ] ${TASK_LINE}\n`);
  put(cwd, CONTRACT_REL, CONTRACT);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo']);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}`);
  return found[1];
}

const skipWith = (cwd, reason) => put(cwd, 'skip.flag', reason);

// The gate's PreToolUse hook on the IDE's task_update call that completes the task.
function tick(cwd) {
  const payload = {
    session_id: 's-contract',
    hook_event_name: 'PreToolUse',
    cwd,
    tool_name: 'task_update',
    tool_input: { tasksFilePath: path.join(cwd, TASKS_REL), taskId: TASK_LINE, status: 'completed', error: '' },
  };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

const MISSING = 'the helper tool is not installed (install helper-tool)';

test('R6.17 verify prints INCOMPLETE naming the contract and what is missing, exits 2, and never prints MISMATCH when a Node contract skips with "cannot run:"', () =>
  temp((cwd) => {
    const rel = frozenProject(cwd);
    assert.equal(necro(cwd, ['verify', rel]).status, 0, 'the genuine receipt is confirmed before the skip');

    skipWith(cwd, `cannot run: ${MISSING}`);
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 2, `exit code 2: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /INCOMPLETE/);
    assert.ok(res.stdout.includes(NAME), `names the contract that did not run: ${res.stdout}`);
    assert.ok(res.stdout.includes(MISSING), `names what is missing: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
  }));

test('R6.17 the same project prints CONFIRMED and exits 0 once the contract no longer skips', () =>
  temp((cwd) => {
    const rel = frozenProject(cwd);
    skipWith(cwd, `cannot run: ${MISSING}`);
    assert.equal(necro(cwd, ['verify', rel]).status, 2);
    fs.rmSync(path.join(cwd, 'skip.flag'));
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /CONFIRMED/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE|MISMATCH/);
  }));

test('R6.17 necro check still fails the contract and prints the reason, with exit 1', () =>
  temp((cwd) => {
    frozenProject(cwd);
    skipWith(cwd, `cannot run: ${MISSING}`);
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1, `check fails: ${res.stdout}${res.stderr}`);
    assert.ok(res.stdout.includes(NAME), `names the failing contract: ${res.stdout}`);
    assert.ok((res.stdout + res.stderr).includes(MISSING), `prints the reason: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /Receipt: /, 'a failing check still writes its receipt (9.2)');
  }));

test('R6.17 the gate refuses the tick of a task whose contract skips with "cannot run:", prints the reason, and allows it once the contract runs', () =>
  temp((cwd) => {
    frozenProject(cwd);
    skipWith(cwd, `cannot run: ${MISSING}`);
    const refused = tick(cwd);
    assert.equal(refused.status, 2, `the gate refuses the tick (exit 2): ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, /Contracts failed:/);
    assert.ok(refused.stderr.includes(NAME), `names the contract: ${refused.stderr}`);
    assert.ok(refused.stderr.includes(MISSING), `prints the reason: ${refused.stderr}`);

    fs.rmSync(path.join(cwd, 'skip.flag'));
    const allowed = tick(cwd);
    assert.equal(allowed.status, 0, `with the contract running the tick is allowed: ${allowed.stdout}${allowed.stderr}`);
  }));

test('R6.17 necro audit counts a ticked task whose contract skips with "cannot run:" as failing and prints the reason', () =>
  temp((cwd) => {
    frozenProject(cwd);
    put(cwd, TASKS_REL, `- [x] ${TASK_LINE}\n`);
    skipWith(cwd, `cannot run: ${MISSING}`);
    const res = necro(cwd, ['audit']);
    assert.notEqual(res.status, 0, `audit does not pass: ${res.stdout}${res.stderr}`);
    assert.ok((res.stdout + res.stderr).includes(NAME), `names the contract: ${res.stdout}${res.stderr}`);
    assert.ok((res.stdout + res.stderr).includes(MISSING), `prints the reason: ${res.stdout}${res.stderr}`);
  }));

for (const [label, reason] of [
  ['another reason', 'flaky on this machine'],
  ['a reason that has "cannot run" but not the prefix with a colon', 'cannot run without a colon'],
  ['a reason that holds the prefix only after other words', 'it said cannot run: the helper tool'],
  ['no reason', ''],
]) {
  test(`R6.17 a skip with ${label} stays a failing contract in verify: MISMATCH, exit 1, never INCOMPLETE`, () =>
    temp((cwd) => {
      const rel = frozenProject(cwd);
      skipWith(cwd, reason);
      const res = necro(cwd, ['verify', rel]);
      assert.equal(res.status, 1, `exit code 1: ${res.stdout}${res.stderr}`);
      assert.match(res.stdout, /MISMATCH/);
      assert.ok(res.stdout.includes(NAME), `names the contract: ${res.stdout}`);
      assert.doesNotMatch(res.stdout, /INCOMPLETE/);
    }));
}

test('R6.17 a skip with another reason is refused by the gate as before', () =>
  temp((cwd) => {
    frozenProject(cwd);
    skipWith(cwd, 'flaky on this machine');
    const res = tick(cwd);
    assert.equal(res.status, 2, `${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /Contracts failed:/);
    assert.ok(res.stderr.includes(NAME), res.stderr);
  }));

test('R6.17 a change to the contract file is still a MISMATCH when it also skips with "cannot run:"', () =>
  temp((cwd) => {
    const rel = frozenProject(cwd);
    put(cwd, CONTRACT_REL, `${CONTRACT}// edited after the freeze\n`);
    skipWith(cwd, `cannot run: ${MISSING}`);
    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /tool\.contract\.test\.js/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE/);
  }));
