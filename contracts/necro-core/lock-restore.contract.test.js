// Contract for Requirement 3.15 of the necro-core spec: an agent's shell cannot move the lock.
//
// R3.15  PreToolUse records .necro/lock.json (or that it is absent) before a shell tool runs, and PostToolUse puts it
//        back first, whatever the command was, so the frozen-file restore of 3.3 works against the lock a person froze.
//
// The test builds a throwaway project, plays the hooks in order with `necro hook pre` / `necro hook post`, and changes
// files in between as a shell command would. The commands are never run. This file carries its own helpers, so it does
// not depend on any file that is not frozen.
//
// The receipt pins the files the hooks use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function hook(cwd, kind, toolName, toolInput) {
  const event = { pre: 'PreToolUse', post: 'PostToolUse' }[kind];
  const payload = { session_id: 's-contract', hook_event_name: event, cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', kind], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-lock-restore-'));
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

function bytes(cwd, rel) {
  return fs.readFileSync(path.join(cwd, rel));
}

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

const LOCK_REL = '.necro/lock.json';
const CONTRACT_REL = 'contracts/demo/c.contract.test.js';
const SHELL_TOOLS = ['execute_bash', 'execute_pwsh', 'control_bash_process', 'control_pwsh_process'];

const PASSING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
`;

// A frozen spec "demo" with one contract.
function frozen(cwd) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, CONTRACT_REL, PASSING);
  freeze(cwd);
}

// What a command that re-freezes the spec after editing its contract leaves behind.
function moveTheLock(cwd) {
  fs.appendFileSync(path.join(cwd, CONTRACT_REL), '\n// edited by the agent\n');
  freeze(cwd);
}

test('R3.15 PostToolUse puts back the lock a shell command moved, byte for byte, before the 3.3 restore; a command that leaves the lock alone prints nothing; a lock a command created is removed', () => {
  // The lock is rewritten by routes 3.14 cannot recognise, and a frozen contract is edited with it.
  for (const command of ['F=freeze; necro $F demo', `node -e "process.stdout.write('x')"`, `echo '{}' > .necro/lock.json`]) {
    temp((cwd) => {
      frozen(cwd);
      const lock = bytes(cwd, LOCK_REL);
      const contract = bytes(cwd, CONTRACT_REL);

      const pre = hook(cwd, 'pre', 'execute_bash', { command });
      assert.equal(pre.status, 0, `${command} is not recognised as freeze: ${pre.stderr}`);
      moveTheLock(cwd);
      assert.notDeepEqual(bytes(cwd, LOCK_REL), lock, 'the command moved the lock');

      const post = hook(cwd, 'post', 'execute_bash', { command });
      assert.equal(post.status, 0, post.stderr);
      assert.deepEqual(bytes(cwd, LOCK_REL), lock, `the lock is back byte for byte after: ${command}`);
      assert.deepEqual(bytes(cwd, CONTRACT_REL), contract, 'the contract is back, restored against the lock the person froze');
      assert.ok(post.stderr.includes(LOCK_REL), `stderr names the lock: ${post.stderr}`);
      assert.match(post.stderr, /person/i, post.stderr);
      assert.match(post.stderr, /freez/i, post.stderr);
      assert.ok(post.stderr.includes(CONTRACT_REL), `stderr also names the restored contract: ${post.stderr}`);
    });
  }

  // A deleted lock comes back, for every Kiro shell tool.
  for (const tool of SHELL_TOOLS) {
    temp((cwd) => {
      frozen(cwd);
      const lock = bytes(cwd, LOCK_REL);
      assert.equal(hook(cwd, 'pre', tool, { command: 'rm .necro/lock.json' }).status, 0);
      fs.rmSync(path.join(cwd, LOCK_REL));
      const post = hook(cwd, 'post', tool, { command: 'rm .necro/lock.json' });
      assert.deepEqual(bytes(cwd, LOCK_REL), lock, `${tool}: the lock is back`);
      assert.ok(post.stderr.includes(LOCK_REL), `${tool}: ${post.stderr}`);
    });
  }

  // A command that does not touch the lock leaves it alone and prints nothing about it.
  temp((cwd) => {
    frozen(cwd);
    const lock = bytes(cwd, LOCK_REL);
    assert.equal(hook(cwd, 'pre', 'execute_bash', { command: 'ls' }).status, 0);
    put(cwd, 'other.txt', 'x');
    const post = hook(cwd, 'post', 'execute_bash', { command: 'ls' });
    assert.equal(post.status, 0);
    assert.equal(post.stderr, '');
    assert.equal(post.stdout, '');
    assert.deepEqual(bytes(cwd, LOCK_REL), lock);
  });

  // A lock that did not exist before the command, and that the command created, is removed again.
  temp((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, CONTRACT_REL, PASSING);
    assert.ok(!fs.existsSync(path.join(cwd, LOCK_REL)));
    assert.equal(hook(cwd, 'pre', 'execute_bash', { command: 'F=freeze; necro $F demo' }).status, 0);
    freeze(cwd);
    assert.ok(fs.existsSync(path.join(cwd, LOCK_REL)), 'the command created a lock');
    const post = hook(cwd, 'post', 'execute_bash', { command: 'F=freeze; necro $F demo' });
    assert.equal(post.status, 0, post.stderr);
    assert.ok(!fs.existsSync(path.join(cwd, LOCK_REL)), 'the lock is removed again');
    assert.ok(post.stderr.includes(LOCK_REL), `stderr names the lock: ${post.stderr}`);
  });
});
