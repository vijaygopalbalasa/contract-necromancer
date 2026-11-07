// Contracts for Requirements 3.14, 6.8 and 8.8 of the necro-core spec: freezing is a person's step.
//
// R3.14  the PreToolUse hook refuses a shell command that runs `necro freeze`.
// R6.8   a receipt written before its spec was frozen again prints SUPERSEDED, not MISMATCH.
// R8.8   `necro init` writes a steering file that says a person freezes specs.
//
// Each test builds a throwaway project in a temp directory and reaches the tool the way Kiro and a reviewer do: through
// `necro hook pre` with a JSON payload on stdin, through `necro verify`, and through `necro init`. This file carries
// its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files these commands use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
//   from '../../src/verify.js'
//   from '../../templates/necromancer.steering.md'
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

function pre(cwd, toolName, toolInput) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-person-freeze-'));
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

const SHELL_TOOLS = ['execute_bash', 'execute_pwsh', 'control_bash_process', 'control_pwsh_process'];

test('R3.14 PreToolUse exits 2 for a shell command that runs necro freeze and says freezing is a person\'s step, and allows necro check, necro verify and a command that only mentions the word', () =>
  temp((cwd) => {
    const blocked = [
      'necro freeze x',
      'node bin/necro.js freeze x',
      'node "/abs/path with space/bin/necro.js" freeze x',
      'npm test && necro freeze x',
      'bash -c "necro freeze x"',
      // Other places the command can sit.
      'npm test; necro freeze x',
      'cat receipt.json | necro freeze x',
      "sh -c 'necro freeze x'",
      'echo done\nnecro freeze x',
      'echo $(necro freeze x)',
      '/usr/local/bin/necro freeze x',
      'node ./bin/necro.js freeze x',
    ];
    for (const command of blocked) {
      const res = pre(cwd, 'execute_bash', { command });
      assert.equal(res.status, 2, `should block ${JSON.stringify(command)}: exit ${res.status} ${res.stdout}${res.stderr}`);
      assert.doesNotMatch(res.stderr, /Hook error/, `a crash also exits 2: ${res.stderr}`);
      assert.match(res.stderr, /person/i, `names a person: ${res.stderr}`);
      assert.match(res.stderr, /freez/i, `names freezing: ${res.stderr}`);
      assert.match(res.stderr, /lock/i, `says it rewrites the lock: ${res.stderr}`);
    }

    // Every Kiro shell tool (R3.12) gets the same rule.
    for (const tool of SHELL_TOOLS) {
      const res = pre(cwd, tool, { command: 'necro freeze x' });
      assert.equal(res.status, 2, `${tool}: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, /person/i, tool);
    }

    // necro check, necro verify and a command that only mentions the word are allowed.
    const allowed = [
      'necro check x',
      'necro verify r.json',
      'echo freeze',
      'grep freeze README.md',
      // Other necro commands and mentions of the word.
      'node bin/necro.js check x',
      'node "/abs/path with space/bin/necro.js" verify r.json',
      'necro init',
      'cat notes | grep freeze',
      'necro check freeze',
      'npm test',
    ];
    for (const command of allowed) {
      for (const tool of ['execute_bash', 'execute_pwsh']) {
        const res = pre(cwd, tool, { command });
        assert.equal(res.status, 0, `should allow ${JSON.stringify(command)}: exit ${res.status} ${res.stderr}`);
        assert.equal(res.stdout, '');
        assert.equal(res.stderr, '');
      }
    }
  }));

const REQ_REL = '.kiro/specs/demo/requirements.md';
const A_REL = 'contracts/demo/a.contract.test.js';
const B_REL = 'contracts/demo/b.contract.test.js';
const LOCK_REL = '.necro/lock.json';

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;
const A = `${HEAD}test('R6.8 first contract', () => { assert.ok(true); });\n`;
const B = `${HEAD}test('R6.8 second contract', () => { assert.equal(1 + 1, 2); });\n`;

// A frozen spec with a genuine receipt made by `necro check`. Returns the receipt's path relative to the project.
function setup(cwd) {
  put(cwd, REQ_REL, '# Requirements: demo\n');
  put(cwd, A_REL, A);
  put(cwd, B_REL, B);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo']);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  return /Receipt: (\S+)/.exec(checked.stdout)[1];
}

function verify(cwd, rel) {
  return necro(cwd, ['verify', rel]);
}

test('R6.8 a receipt written before its spec was frozen again prints SUPERSEDED with the spec and the changed paths and exits 1, not MISMATCH, but a receipt whose files no longer match the lock is still a MISMATCH', () =>
  temp((cwd) => {
    const rel = setup(cwd);
    assert.equal(verify(cwd, rel).status, 0, 'the receipt is confirmed before the spec is frozen again');

    // The requirements and one contract file change, and a person freezes the spec again. The files on disk match the new lock.
    fs.appendFileSync(path.join(cwd, REQ_REL), 'A new criterion.\n');
    fs.appendFileSync(path.join(cwd, B_REL), '// reworded\n');
    const again = necro(cwd, ['freeze', 'demo']);
    assert.equal(again.status, 0, `freeze failed: ${again.stderr}${again.stdout}`);

    const res = verify(cwd, rel);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /SUPERSEDED/);
    assert.doesNotMatch(res.stdout, /MISMATCH/, 'a superseded receipt is not reported as a mismatch');
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
    assert.ok(res.stdout.includes('demo'), `names the spec: ${res.stdout}`);
    assert.ok(res.stdout.includes(REQ_REL), `names the requirements path: ${res.stdout}`);
    assert.ok(res.stdout.includes(B_REL), `names the contract file that changed: ${res.stdout}`);
    assert.ok(!res.stdout.includes(A_REL), `does not name the contract file that did not change: ${res.stdout}`);
    assert.match(res.stdout, /earlier freeze/i, 'says the receipt describes an earlier freeze');
    assert.match(res.stdout, /not today'?s code/i, "says the receipt is not about today's code");

    whenDiskDiffersFromLock();
  }));

// The same receipt is still a MISMATCH when the files on disk do not match the lock, in a project of its own.
function whenDiskDiffersFromLock() {
  temp((cwd) => {
    const rel = setup(cwd);
    const lockFile = path.join(cwd, LOCK_REL);
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

    // The lock is edited, so the requirements on disk (and in the receipt) differ from it.
    lock.specs.demo.requirements.sha256 = 'a'.repeat(64);
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
    const edited = verify(cwd, rel);
    assert.equal(edited.status, 1, `${edited.stdout}${edited.stderr}`);
    assert.match(edited.stdout, /MISMATCH/);
    assert.doesNotMatch(edited.stdout, /SUPERSEDED/);
    assert.ok(edited.stdout.includes(REQ_REL), edited.stdout);

    // The spec is frozen again, then a contract file changes on disk: the files do not match the new lock either.
    fs.appendFileSync(path.join(cwd, REQ_REL), 'A new criterion.\n');
    const again = necro(cwd, ['freeze', 'demo']);
    assert.equal(again.status, 0, `freeze failed: ${again.stderr}${again.stdout}`);
    assert.match(verify(cwd, rel).stdout, /SUPERSEDED/, 'the files match the new lock');
    fs.appendFileSync(path.join(cwd, A_REL), '// edited after the second freeze\n');
    const drifted = verify(cwd, rel);
    assert.equal(drifted.status, 1, `${drifted.stdout}${drifted.stderr}`);
    assert.match(drifted.stdout, /MISMATCH/);
    assert.doesNotMatch(drifted.stdout, /SUPERSEDED/);
  });
}

test('R8.8 init writes a steering file saying a person freezes specs, the agent never runs necro freeze, and frozen specs are listed in .necro/lock.json', () =>
  temp((project) => {
    const res = necro(project, ['init']);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const steering = fs.readFileSync(path.join(project, '.kiro/steering/necromancer.md'), 'utf8');

    assert.match(steering, /\bperson\b[^.\n]*\bfreez|\bfrozen by a person\b/i, 'says a person freezes specs');
    assert.match(steering, /\bnever\b[^.\n]*`necro freeze`/i, 'says the agent never runs `necro freeze`');
    assert.ok(steering.includes('.necro/lock.json'), 'says frozen specs are listed in .necro/lock.json');

    // It no longer tells the agent to run `necro freeze`: every sentence that names the command forbids it.
    const sentences = steering
      .split(/\n{2,}|(?<=[.!?])\s+/)
      .map((s) => s.replace(/\s+/g, ' '))
      .filter((s) => s.includes('necro freeze'));
    assert.ok(sentences.length > 0);
    for (const sentence of sentences) {
      assert.match(sentence, /\b(never|not|cannot|blocks?)\b/i, `must not tell the agent to freeze: ${sentence}`);
    }
    assert.doesNotMatch(steering, /by running `necro freeze/i);
    assert.doesNotMatch(steering, /run `necro freeze <spec>` to/i);

    // The earlier guidance stays.
    assert.match(steering, /frozen contracts/i);
    assert.match(steering, /do not edit/i);
  }));
