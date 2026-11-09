// Contract for Requirement 14.6 of the necro-core spec: an upgrade must not untick older work.
//
// R14.6  With a lock that records no list of tasks ticked at freeze (a lock written before Requirement 14), `necro hook
//        stop` and `necro hook posttask` untick nothing for that spec and print once that a person must freeze it again
//        to turn the check on, while `necro audit` still reports every verdict.
//
// The test builds a throwaway project in a temp directory, freezes it with `necro freeze` there, then removes the
// `ticked` list from its lock to get the lock an older version wrote. This file carries its own helpers.
//
// The receipt pins the files the hooks and the audit use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/audit.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = path.join(import.meta.dirname, '..', '..', 'bin', 'necro.js');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-upgrade-'));
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

function read(cwd, rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

const TASKS_REL = '.kiro/specs/demo/tasks.md';
const LOCK_REL = '.necro/lock.json';
const TASK1 = '1. First (Req 1.1)';
const TASK2 = '2. Second (Req 2.1)';

const ALWAYS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 first holds', () => { assert.ok(true); });
`;
// R2.1 holds while flag.txt says "ok", so the test can break it after the freeze.
const FLAGGED = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R2.1 second holds', () => {
  assert.equal(fs.readFileSync(new URL('../../flag.txt', import.meta.url), 'utf8').trim(), 'ok');
});
`;

function tasksText(ticked = []) {
  return [TASK1, TASK2].map((t) => `- [${ticked.includes(t) ? 'x' : ' '}] ${t}`).join('\n') + '\n';
}

// A project frozen by `necro freeze`, whose lock is then made the lock an older version wrote: no `ticked` list.
// Both tasks are ticked, by editing the file, and the second one's contract fails.
function upgradedProject(cwd) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS);
  put(cwd, 'contracts/demo/b.contract.test.js', FLAGGED);
  put(cwd, 'flag.txt', 'ok\n');
  put(cwd, TASKS_REL, tasksText());
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);

  const lock = JSON.parse(read(cwd, LOCK_REL));
  assert.ok(Array.isArray(lock.specs.demo.ticked), 'a new lock records the ticked list');
  delete lock.specs.demo.ticked;
  put(cwd, LOCK_REL, JSON.stringify(lock, null, 2) + '\n');

  put(cwd, TASKS_REL, tasksText([TASK1, TASK2]));
  put(cwd, 'flag.txt', 'broken\n');
}

test('R14.6 a lock with no list of tasks ticked at freeze: stop and posttask untick nothing and say once that a person must freeze again, while necro audit still reports every verdict', () => {
  for (const hook of ['stop', 'posttask']) {
    for (const input of ['', '{}']) {
      temp((cwd) => {
        upgradedProject(cwd);
        const label = `${hook} with input ${JSON.stringify(input)}`;
        const res = necro(cwd, ['hook', hook], input);
        assert.equal(res.status, 0, `${label}: ${res.stderr}`);
        assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK2]), `${label}: no task is unticked`);
        const messages = res.stderr.split('\n').filter((l) => l.trim() !== '');
        assert.equal(messages.length, 1, `${label}: one message on stderr, got: ${res.stderr}`);
        assert.match(messages[0], /freeze/i, label);
        assert.ok(messages[0].includes('demo'), `${label}: the message names the spec`);
        assert.doesNotMatch(res.stderr, /unticked/i, label);
      });
    }
  }

  temp((cwd) => {
    upgradedProject(cwd);
    const before = read(cwd, TASKS_REL);
    const res = necro(cwd, ['audit']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const line = (title) => res.stdout.split('\n').find((l) => l.includes(title)) || '';
    assert.match(line('First'), /^\s*no receipt\b/, 'a ticked task with no receipt and no list to credit it');
    assert.match(line('Second'), /^\s*failing\b/, 'a ticked task whose contract fails');
    assert.ok(line('Second').includes('R2.1 second holds'), 'names the failing contract');
    assert.equal(read(cwd, TASKS_REL), before, 'the audit changes nothing');
  });

  // A lock that does record the list is not the upgrade case: the same ticks are undone.
  temp((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS);
    put(cwd, TASKS_REL, tasksText());
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    put(cwd, TASKS_REL, tasksText([TASK1]));
    const res = necro(cwd, ['hook', 'posttask'], '');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, TASKS_REL), tasksText(), 'a tick with no receipt is undone when the list is recorded');
  });
});
