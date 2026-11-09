// Contracts for Requirement 14 of the necro-core spec: catch a tick however it got there.
//
// R14.1  `necro audit` lists every ticked task with one verdict (ok, no receipt, failing) and exits 0 only if all are ok.
// R14.2  `necro audit` changes no file.
// R14.3  `necro hook stop` and `necro hook posttask`, given any or empty input, put every ticked task that is not ok
//        back to `[ ]` and say why on stderr; ok tasks stay ticked.
// R14.4  `necro init` writes a PostTaskExec hook that runs `necro hook posttask` in the hooks file and the custom agent,
//        with the same timeout as the others.
// R14.5  The repository's CI runs `necro audit` on every push, and the README shows the one CI step a project adds.
//
// The tests build throwaway projects in a temp directory, freeze them with `necro freeze` there, and let the gate write
// its receipts with `necro hook pre`, the way the Kiro IDE calls it. R14.5 reads this repository's workflow and README
// as text; it does not run `necro audit` here, because the audit would run this file again. This file carries its own
// helpers.
//
// The receipt pins the files the audit uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/audit.js'
//   from '../../src/hooks.js'
//   from '../../templates/necromancer.hooks.json'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-audit-'));
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
const TASK1 = '1. First (Req 1.1)';
const TASK2 = '2. Second (Req 2.1)';
const TASK3 = '3. Third (Req 1.1)';

// R1.1 always holds. R2.1 holds while flag.txt says "ok", so a test can break it after the freeze.
const ALWAYS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 first holds', () => { assert.ok(true); });
`;
const FLAGGED = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R2.1 second holds', () => {
  assert.equal(fs.readFileSync(new URL('../../flag.txt', import.meta.url), 'utf8').trim(), 'ok');
});
`;

function tasksText(ticked = []) {
  return [TASK1, TASK2, TASK3].map((t) => `- [${ticked.includes(t) ? 'x' : ' '}] ${t}`).join('\n') + '\n';
}

// A frozen spec "demo" with two contract files and three tasks; `ticked` are ticked when the project is frozen.
function frozen(cwd, ticked = []) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS);
  put(cwd, 'contracts/demo/b.contract.test.js', FLAGGED);
  put(cwd, 'flag.txt', 'ok\n');
  put(cwd, TASKS_REL, tasksText(ticked));
  const res = necro(cwd, ['freeze', 'demo']);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

// The gate lets task `text` through, as the Kiro IDE's task tool would ask it, and writes a receipt for it.
function gate(cwd, text) {
  const payload = {
    session_id: 's-contract',
    hook_event_name: 'PreToolUse',
    cwd,
    tool_name: 'task_update',
    tool_input: { tasksFilePath: TASKS_REL, taskId: text, status: 'completed' },
  };
  const res = necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
  assert.equal(res.status, 0, `the gate refused ${text}: ${res.stderr}`);
}

// The verdict `necro audit` prints for the task whose line holds `title`.
function verdictOf(stdout, title) {
  const line = stdout.split('\n').find((l) => l.includes(title));
  assert.ok(line, `a line for ${title} in:\n${stdout}`);
  for (const verdict of ['no receipt', 'failing', 'ok']) if (line.trimStart().startsWith(verdict)) return { verdict, line };
  assert.fail(`no verdict at the start of: ${line}`);
}

// Every file under dir with its hash.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('R14.1 necro audit lists every ticked task as ok, no receipt or failing, and exits 0 only when all are ok', () =>
  temp((cwd) => {
    // Task 1 is ticked when the person freezes. Task 2 goes through the gate. Task 3 is ticked by editing the file.
    frozen(cwd, [TASK1]);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2, TASK3]));

    const mixed = necro(cwd, ['audit']);
    assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
    assert.equal(verdictOf(mixed.stdout, 'First').verdict, 'ok', 'ticked at the freeze, contracts pass');
    assert.equal(verdictOf(mixed.stdout, 'Second').verdict, 'ok', 'the gate wrote a receipt for it');
    assert.equal(verdictOf(mixed.stdout, 'Third').verdict, 'no receipt', 'ticked with no hook');
    assert.ok(!mixed.stdout.includes('- [ ]'), 'unticked tasks are not listed');

    // A ticked task whose required contract fails now is failing and names the contract. Task 1 needs only R1.1.
    put(cwd, 'flag.txt', 'broken\n');
    const broken = necro(cwd, ['audit', 'demo']);
    assert.equal(broken.status, 1);
    const second = verdictOf(broken.stdout, 'Second');
    assert.equal(second.verdict, 'failing');
    assert.ok(second.line.includes('R2.1 second holds'), `names the failing contract: ${second.line}`);
    assert.equal(verdictOf(broken.stdout, 'First').verdict, 'ok');

    // With only ok tasks the exit code is 0.
    put(cwd, 'flag.txt', 'ok\n');
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2]));
    const good = necro(cwd, ['audit']);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.equal(verdictOf(good.stdout, 'Second').verdict, 'ok');
  }));

test('R14.2 necro audit changes no file', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2, TASK3]));
    put(cwd, 'flag.txt', 'broken\n');
    const before = snapshot(cwd);
    const res = necro(cwd, ['audit']);
    assert.equal(res.status, 1);
    assert.deepEqual(snapshot(cwd), before, 'no file was added, removed or changed');
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK2, TASK3]));
  }));

test('R14.3 necro hook stop and necro hook posttask, given any or empty input, untick every task that is not ok, say why on stderr and leave ok tasks alone', () => {
  for (const hook of ['stop', 'posttask']) {
    for (const input of ['', 'not json', '{}', '{"hook_event_name":"PostTaskExec","cwd":"/","tool_input":{"x":1}}']) {
      temp((cwd) => {
        frozen(cwd, [TASK1]);
        gate(cwd, TASK2);
        put(cwd, TASKS_REL, tasksText([TASK1, TASK2, TASK3])); // task 3 was ticked with no gate
        const res = necro(cwd, ['hook', hook], input);
        const label = `${hook} with input ${JSON.stringify(input)}`;
        assert.equal(res.status, 0, `${label}: ${res.stderr}`);
        assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK2]), `${label}: only task 3 goes back to [ ]`);
        assert.ok(res.stderr.includes('Third'), `${label}: stderr names the task: ${res.stderr}`);
        assert.match(res.stderr, /no receipt/, label);
      });
    }
  }

  // A task whose required contract fails now is unticked too, with the contract named.
  for (const hook of ['stop', 'posttask']) {
    temp((cwd) => {
      frozen(cwd);
      gate(cwd, TASK2);
      put(cwd, TASKS_REL, tasksText([TASK2]));
      put(cwd, 'flag.txt', 'broken\n');
      const res = necro(cwd, ['hook', hook], '');
      assert.equal(res.status, 0, res.stderr);
      assert.equal(read(cwd, TASKS_REL), tasksText());
      assert.ok(res.stderr.includes('R2.1 second holds'), `${hook}: ${res.stderr}`);
    });
  }

  // Nothing to undo: nothing is printed and nothing changes.
  for (const hook of ['stop', 'posttask']) {
    temp((cwd) => {
      frozen(cwd, [TASK1]);
      const before = snapshot(cwd);
      const res = necro(cwd, ['hook', hook], '');
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stderr, '', hook);
      assert.deepEqual(snapshot(cwd), before, hook);
    });
  }
});

test('R14.4 necro init writes a PostTaskExec hook that runs necro hook posttask in the hooks file and the custom agent, with the same timeout as the others', () =>
  temp((project) => {
    const res = necro(project, ['init']);
    assert.equal(res.status, 0, res.stderr);
    const hooksFile = JSON.parse(read(project, '.kiro/hooks/necromancer.json'));
    const agent = JSON.parse(read(project, '.kiro/agents/necromancer.json'));
    for (const [label, hooks] of [['hooks file', hooksFile.hooks], ['custom agent', agent.hooks]]) {
      const found = hooks.filter((h) => h.trigger === 'PostTaskExec');
      assert.equal(found.length, 1, `${label}: one PostTaskExec hook`);
      assert.equal(found[0].action.type, 'command', label);
      assert.match(found[0].action.command, /^".*" ".*necro\.js" hook posttask$/, label);
      const stop = hooks.find((h) => h.trigger === 'Stop');
      assert.equal(found[0].timeout, stop.timeout, `${label}: same timeout as the Stop hook`);
      assert.equal(found[0].timeout, 300, label);
    }
  }));

test('R14.5 the repository CI runs necro audit on every push, and the README shows the one CI step a project adds', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'test.yml'), 'utf8');
  // `push:` with no branch filter runs on every push.
  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(on, /\n\s+push:\s*\n/, 'the workflow runs on push');
  assert.doesNotMatch(on, /branches/, 'with no branch filter');
  const steps = workflow.split(/\n\s+- name: /).slice(1);
  assert.ok(steps.some((s) => /\n\s+run:\s*node bin\/necro\.js audit\s*(\n|$)/.test(s)), 'a CI step runs node bin/necro.js audit');

  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const blocks = [...readme.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map((m) => m[1]);
  const step = blocks.find((b) => /\baudit\b/.test(b));
  assert.ok(step, 'the README has a yaml block with the audit step');
  assert.match(step, /^- name: .+\n\s+run: .*\baudit\s*$/m, 'one step: a name and a run line that ends in audit');
  assert.equal((step.match(/^\s*- name:/gm) || []).length, 1, 'exactly one step');
});
