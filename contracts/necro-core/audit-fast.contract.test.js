// Contracts for Requirements 14.7 to 14.9 of the necro-core spec: a fast safety net, honest receipts, a steady CI.
//
// R14.7  `necro hook stop` and `necro hook posttask` audit only the tasks ticked now that were not ticked when a person
//        last froze the spec, and run only the contracts those tasks require; `necro audit` still checks every ticked task.
// R14.8  The README says that receipts are files in the project, so an agent able to write files can add one, and that a
//        forged receipt can fake where a tick came from, not whether the work holds.
// R14.9  The repository's CI runs `necro audit` and re-runs the newest receipt of each spec of the two examples only.
//
// R14.7 builds a throwaway project in a temp directory. Each contract file there appends its name to runs.log when it
// loads, so the test counts the runs. This file carries its own helpers.
//
// The receipt pins the files the hooks and the audit use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/audit.js'
//   from '../../src/contracts.js'
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

function necro(cwd, args, input = '') {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-fast-'));
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

const TASKS_REL = '.kiro/specs/big/tasks.md';
const TASKS = ['1. One (Req 1.1)', '2. Two (Req 2.1)', '3. Three (Req 3.1)', '4. Four (Req 4.1)', '5. Five (Req 5.1)'];

function tasksText(ticked) {
  return TASKS.map((t, i) => `- [${ticked.includes(i + 1) ? 'x' : ' '}] ${t}`).join('\n') + '\n';
}

// Contract file n appends "c<n>" to runs.log whenever it is loaded. Its contract R<n>.1 fails while broken-<n> exists.
function contractFile(n) {
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.appendFileSync(new URL('../../runs.log', import.meta.url), 'c${n}\\n');
test('R${n}.1 holds', () => {
  assert.ok(!fs.existsSync(new URL('../../broken-${n}', import.meta.url)));
});
`;
}

// A spec frozen by `necro freeze` with four contract files and five tasks, tasks 1 to 3 ticked at the freeze. Task 4 is
// ticked afterwards, and its contract and that of task 1 are broken. runs.log is cleared so only later runs are counted.
function project(cwd) {
  put(cwd, '.kiro/specs/big/requirements.md', '# Requirements: big\n');
  for (const n of [1, 2, 3, 4]) put(cwd, `contracts/big/c${n}.contract.test.js`, contractFile(n));
  put(cwd, TASKS_REL, tasksText([1, 2, 3]));
  const frozen = necro(cwd, ['freeze', 'big']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  put(cwd, TASKS_REL, tasksText([1, 2, 3, 4]));
  put(cwd, 'broken-4', '');
  put(cwd, 'broken-1', '');
  fs.rmSync(path.join(cwd, 'runs.log'), { force: true });
}

function runs(cwd) {
  try {
    return read(cwd, 'runs.log')
      .split('\n')
      .filter((l) => l !== '')
      .sort();
  } catch {
    return [];
  }
}

test('R14.7 stop and posttask run only the contracts of the task ticked since the freeze and untick it; the others are left alone', () => {
  for (const hook of ['stop', 'posttask']) {
    temp((cwd) => {
      project(cwd);
      const res = necro(cwd, ['hook', hook]);
      assert.equal(res.status, 0, `${hook}: ${res.stderr}`);
      assert.deepEqual(runs(cwd), ['c4'], `${hook}: only the contract file of task 4 ran`);
      assert.equal(read(cwd, TASKS_REL), tasksText([1, 2, 3]), `${hook}: task 4 is unticked, tasks 1 to 3 stay ticked`);
      assert.match(res.stderr, /Unticked "4\. Four \(Req 4\.1\)"/, hook);
      assert.ok(res.stderr.includes('R4.1 holds'), `${hook}: names the failing contract`);
    });
  }
});

test('R14.7 posttask runs no contract when no task was ticked since the freeze', () =>
  temp((cwd) => {
    project(cwd);
    put(cwd, TASKS_REL, tasksText([1, 2, 3]));
    fs.rmSync(path.join(cwd, 'runs.log'), { force: true });
    const res = necro(cwd, ['hook', 'posttask']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(runs(cwd), []);
    assert.equal(res.stderr, '');
    assert.equal(read(cwd, TASKS_REL), tasksText([1, 2, 3]));
  }));

test('R14.7 necro audit still checks every ticked task, and changes nothing', () =>
  temp((cwd) => {
    project(cwd);
    const res = necro(cwd, ['audit']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.deepEqual(runs(cwd), ['c1', 'c2', 'c3', 'c4']);
    const line = (title) => res.stdout.split('\n').find((l) => l.includes(title)) || '';
    assert.match(line('One'), /^\s*failing\b/, 'a task ticked at the freeze is checked by the audit');
    assert.match(line('Four'), /^\s*failing\b/, 'a task ticked since the freeze is checked too');
    assert.match(line('Two'), /^\s*ok\b/);
    assert.equal(read(cwd, TASKS_REL), tasksText([1, 2, 3, 4]));
  }));

test('R14.8 the README says receipts are files an agent can add, and what a forged receipt can and cannot do', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /receipts are files in the project/i);
  assert.match(readme, /an agent able to write files can add one/i);
  assert.match(readme, /forged receipt can only make `necro audit` accept a task whose required contracts pass now/i);
  assert.match(readme, /fake where a tick came from, not whether the work holds/i);
});

test('R14.9 CI runs necro audit and re-runs the newest receipt of each spec of the two examples only', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(workflow, /^\s*run:\s*node bin\/necro\.js audit\s*$/m, 'a step runs necro audit for this repository');
  const loops = [...workflow.matchAll(/for dir in ([^;\n]*);\s*do/g)];
  assert.equal(loops.length, 1, 'one loop over project folders');
  assert.deepEqual(loops[0][1].trim().split(/\s+/), ['examples/pumpkin-ledger', 'examples/night-shift']);
  assert.match(workflow, /node bin\/necro\.js verify "\$newest"/);
});
