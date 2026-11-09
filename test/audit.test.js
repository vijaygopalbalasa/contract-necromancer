import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../src/canon.js';
import { freezeSpec, readLock, writeLock } from '../src/lock.js';
import { handlePreToolUse, handleStop, handlePostTaskExec } from '../src/hooks.js';
import { auditSpec } from '../src/audit.js';

const BIN = path.join(import.meta.dirname, '..', 'bin', 'necro.js');

// The test runner sets NODE_TEST_* variables. A nested run must not see them.
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

function read(cwd, rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

const TASKS_REL = '.kiro/specs/demo/tasks.md';

// R1.1 always passes. R2.1 passes while flag.txt says "ok" and fails otherwise, so a test can break it after freezing.
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

const TASK1 = '1. First (Req 1.1)';
const TASK2 = '2. Second (Req 2.1)';
const TASK3 = '3. Third (Req 1.1)';

function tasksText(ticked = []) {
  return [TASK1, TASK2, TASK3].map((t) => `- [${ticked.includes(t) ? 'x' : ' '}] ${t}`).join('\n') + '\n';
}

// A frozen spec "demo" with two contract files and three tasks; `ticked` are ticked when the person freezes.
function frozen(cwd, ticked = []) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS);
  put(cwd, 'contracts/demo/b.contract.test.js', FLAGGED);
  put(cwd, 'flag.txt', 'ok\n');
  put(cwd, TASKS_REL, tasksText(ticked));
  freezeSpec(cwd, 'demo');
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-audit-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// The gate lets task `text` through, as the Kiro IDE's task tool would ask it, and writes a receipt.
function gate(cwd, text) {
  const res = handlePreToolUse({
    hook_event_name: 'PreToolUse',
    cwd,
    tool_name: 'task_update',
    tool_input: { tasksFilePath: TASKS_REL, taskId: text, status: 'completed' },
  });
  assert.equal(res.exitCode, 0, res.stderr);
}

function verdicts(cwd) {
  const out = {};
  for (const t of auditSpec(cwd, 'demo').tasks) out[t.id] = t;
  return out;
}

// Every file under dir with its hash, to show that a command changed nothing.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = sha256(fs.readFileSync(abs));
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Req 14.1: the verdict of each ticked task
// ---------------------------------------------------------------------------

test('R14.1 a task ticked by editing tasks.md directly, with no gate, is "no receipt"; an unticked task is not listed', () =>
  temp((cwd) => {
    frozen(cwd);
    put(cwd, TASKS_REL, tasksText([TASK2]));
    const v = verdicts(cwd);
    assert.deepEqual(Object.keys(v), ['2']);
    assert.equal(v['2'].verdict, 'no receipt');
    assert.deepEqual(v['2'].failing, []);
  }));

test('R14.1 a task the gate wrote a receipt for is "ok"', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK2]));
    assert.equal(verdicts(cwd)['2'].verdict, 'ok');
  }));

test('R14.1 a task that was ticked when a person froze the spec, with passing contracts, is "ok"', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1, TASK2]);
    const v = verdicts(cwd);
    assert.equal(v['1'].verdict, 'ok');
    assert.equal(v['2'].verdict, 'ok');
  }));

test('R14.1 a ticked task whose required contract fails now is "failing" and names it; contracts of other tasks do not count', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK1);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2]));
    put(cwd, 'flag.txt', 'broken\n');
    const v = verdicts(cwd);
    assert.equal(v['2'].verdict, 'failing');
    assert.deepEqual(v['2'].failing, ['R2.1 second holds']);
    assert.equal(v['1'].verdict, 'ok', 'task 1 requires only R1.1, which still passes');
  }));

test('R14.1 a receipt written for a task under an earlier freeze still counts', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK2]));
    put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS + "test('R1.2 extra', () => { assert.ok(true); });\n");
    freezeSpec(cwd, 'demo'); // frozen again by a person, with task 2 already ticked
    assert.equal(verdicts(cwd)['2'].verdict, 'ok');
    // Same with the tick state of the new freeze removed: the old receipt alone is enough.
    const lock = readLock(cwd);
    delete lock.specs.demo.ticked;
    writeLock(cwd, lock);
    assert.equal(verdicts(cwd)['2'].verdict, 'ok');
  }));

test('R14.1 a lock written before ticked tasks were recorded gives no credit for the freeze: "no receipt"', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1]);
    const lock = readLock(cwd);
    delete lock.specs.demo.ticked;
    writeLock(cwd, lock);
    assert.equal(verdicts(cwd)['1'].verdict, 'no receipt');
  }));

test('R14.1 a check receipt (no task) is not a receipt for a task', () =>
  temp((cwd) => {
    frozen(cwd);
    assert.equal(necro(cwd, ['check', 'demo']).status, 0);
    put(cwd, TASKS_REL, tasksText([TASK2]));
    assert.equal(verdicts(cwd)['2'].verdict, 'no receipt');
  }));

test('R14.1 a receipt whose hash was edited, or one for another task, is not evidence', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK1);
    const dir = path.join(cwd, '.necro/receipts/demo');
    for (const f of fs.readdirSync(dir)) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      r.task = { id: '2', line: TASK2 }; // claims to be for task 2, receiptHash no longer matches
      fs.writeFileSync(path.join(dir, f), JSON.stringify(r));
    }
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2]));
    const v = verdicts(cwd);
    assert.equal(v['1'].verdict, 'no receipt');
    assert.equal(v['2'].verdict, 'no receipt');
  }));

test('R14.1 an extra ticked line with the text of a task ticked at freeze gets no credit', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1]);
    put(cwd, TASKS_REL, tasksText([TASK1]) + `- [x] ${TASK1}\n`);
    const lines = auditSpec(cwd, 'demo').tasks.filter((t) => t.text === TASK1);
    assert.deepEqual(lines.map((t) => t.verdict), ['ok', 'no receipt']);
  }));

test('R14.1 necro audit prints one verdict per ticked task and exits 0 only when all are ok', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK1);
    put(cwd, TASKS_REL, tasksText([TASK1]));
    const good = necro(cwd, ['audit']);
    assert.equal(good.status, 0, good.stderr + good.stdout);
    assert.match(good.stdout, /\bok\b.*First/);

    put(cwd, TASKS_REL, tasksText([TASK1, TASK2]));
    const bad = necro(cwd, ['audit', 'demo']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /\bok\b.*First/);
    assert.match(bad.stdout, /no receipt.*Second/);

    put(cwd, 'flag.txt', 'broken\n'); // task 2 is ticked and its contract fails now
    const failing = necro(cwd, ['audit', 'demo']);
    assert.equal(failing.status, 1);
    assert.match(failing.stdout, /failing.*Second.*R2\.1 second holds/);
  }));

test('R14.1 necro audit with no frozen spec exits 0; with a spec that is not frozen it exits 1 and says so', () =>
  temp((cwd) => {
    const none = necro(cwd, ['audit']);
    assert.equal(none.status, 0, none.stderr);
    frozen(cwd);
    const missing = necro(cwd, ['audit', 'other']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /not frozen/);
  }));

// ---------------------------------------------------------------------------
// Req 14.2: audit changes no file
// ---------------------------------------------------------------------------

test('R14.2 necro audit changes no file, also when tasks are not ok', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2, TASK3]));
    put(cwd, 'flag.txt', 'broken\n');
    const before = snapshot(cwd);
    const res = necro(cwd, ['audit']);
    assert.equal(res.status, 1);
    assert.deepEqual(snapshot(cwd), before);
  }));

// ---------------------------------------------------------------------------
// Req 14.3: Stop and PostTaskExec undo ticks that are not ok
// ---------------------------------------------------------------------------

function hookPostTask(cwd, input) {
  return necro(cwd, ['hook', 'posttask'], input);
}

test('R14.3 necro hook posttask unticks a task that is not ok, says why on stderr, and leaves ok tasks alone', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1]);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK2, TASK3])); // task 3 ticked with no gate
    const res = hookPostTask(cwd, JSON.stringify({ hook_event_name: 'PostTaskExec', session_id: 's' }));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK2]), 'only task 3 is put back to [ ]');
    assert.match(res.stderr, /Third/);
    assert.match(res.stderr, /no receipt/);
    assert.equal(res.stdout, '');
  }));

test('R14.3 a failing task is unticked and the failing contracts are named', () =>
  temp((cwd) => {
    frozen(cwd);
    gate(cwd, TASK2);
    put(cwd, TASKS_REL, tasksText([TASK2]));
    put(cwd, 'flag.txt', 'broken\n');
    const res = hookPostTask(cwd, '');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, TASKS_REL), tasksText());
    assert.match(res.stderr, /R2\.1 second holds/);
  }));

test('R14.3 posttask does not depend on its input: empty, not JSON, JSON of another shape, or a wrong cwd all give the same result', () => {
  for (const input of ['', 'not json', '{}', '[]', 'null', '{"cwd":"/","tool_name":"x","tasksFilePath":"../../etc/passwd"}']) {
    temp((cwd) => {
      frozen(cwd);
      put(cwd, TASKS_REL, tasksText([TASK2]));
      const res = hookPostTask(cwd, input);
      assert.equal(res.status, 0, `${JSON.stringify(input)}: ${res.stderr}`);
      assert.equal(read(cwd, TASKS_REL), tasksText(), `input ${JSON.stringify(input)}`);
    });
  }
});

test('R14.3 posttask with nothing to undo prints nothing and changes nothing', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1]);
    const before = snapshot(cwd);
    const res = hookPostTask(cwd, '');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, '');
    assert.deepEqual(snapshot(cwd), before);
  }));

test('R14.3 necro hook stop prints the summary, then unticks the tasks that are not ok, also with empty input', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1]);
    put(cwd, TASKS_REL, tasksText([TASK1, TASK3]));
    const res = necro(cwd, ['hook', 'stop'], '');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^Spec demo: 2 tasks done, 0 receipts, passing\.$/m, 'the summary counts the ticks Stop found');
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1]));
    assert.match(res.stderr, /Third/);
    assert.match(res.stderr, /no receipt/);
  }));

test('R14.3 handleStop leaves the tasks of a spec with only ok ticks alone', () =>
  temp((cwd) => {
    frozen(cwd, [TASK1, TASK3]);
    const res = handleStop({ cwd });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK3]));
  }));

test('R14.3 the unticked line keeps its text, indent, marker and line endings', () =>
  temp((cwd) => {
    frozen(cwd);
    put(cwd, TASKS_REL, `# Tasks\r\n\r\n- [ ] ${TASK1}\r\n  - [X] ${TASK2}\r\n  (Req 2.1)\r\n- [ ] ${TASK3}\r\n`);
    const res = hookPostTask(cwd, '');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, TASKS_REL), `# Tasks\r\n\r\n- [ ] ${TASK1}\r\n  - [ ] ${TASK2}\r\n  (Req 2.1)\r\n- [ ] ${TASK3}\r\n`);
  }));

// ---------------------------------------------------------------------------
// Req 14.6: a lock with no list of ticked tasks turns the undo off
// ---------------------------------------------------------------------------

// A lock written before Req 14: the spec is frozen but the lock records no ticked list.
function legacyFrozen(cwd, ticked) {
  frozen(cwd, []);
  const lock = readLock(cwd);
  delete lock.specs.demo.ticked;
  writeLock(cwd, lock);
  put(cwd, TASKS_REL, tasksText(ticked));
}

const FREEZE_AGAIN = /freeze/i;

test('R14.6 posttask with a lock that has no ticked list unticks nothing and says once that a person must freeze again', () =>
  temp((cwd) => {
    legacyFrozen(cwd, [TASK1, TASK2, TASK3]);
    const res = handlePostTaskExec({ cwd });
    assert.equal(res.exitCode, 0);
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK2, TASK3]), 'no task is unticked');
    assert.match(res.stderr, FREEZE_AGAIN);
    assert.ok(res.stderr.includes('demo'), 'names the spec');
    assert.equal(res.stderr.split('\n').filter((l) => l.trim() !== '').length, 1, 'one message');
    assert.ok(!/Unticked/.test(res.stderr));
  }));

test('R14.6 stop with a lock that has no ticked list unticks nothing, still prints the summary, and says once that a person must freeze again', () =>
  temp((cwd) => {
    legacyFrozen(cwd, [TASK1, TASK3]);
    const res = handleStop({ cwd });
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /^Spec demo: 2 tasks done/m);
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK1, TASK3]));
    assert.match(res.stderr, FREEZE_AGAIN);
    assert.equal(res.stderr.split('\n').filter((l) => l.trim() !== '').length, 1);
  }));

test('R14.6 the same holds through the CLI with empty input, and a failing contract does not change that', () =>
  temp((cwd) => {
    legacyFrozen(cwd, [TASK2]);
    put(cwd, 'flag.txt', 'broken\n');
    for (const hook of ['stop', 'posttask']) {
      const res = necro(cwd, ['hook', hook], '');
      assert.equal(res.status, 0, res.stderr);
      assert.equal(read(cwd, TASKS_REL), tasksText([TASK2]), hook);
      assert.match(res.stderr, FREEZE_AGAIN, hook);
    }
  }));

test('R14.6 necro audit still reports every verdict for a lock with no ticked list', () =>
  temp((cwd) => {
    legacyFrozen(cwd, [TASK1, TASK2]);
    put(cwd, 'flag.txt', 'broken\n');
    const res = necro(cwd, ['audit']);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /no receipt\s+1\. First/);
    assert.match(res.stdout, /failing\s+2\. Second/);
  }));

test('R14.6 a spec whose lock has a ticked list is still audited and undone, next to a spec that has none', () =>
  temp((cwd) => {
    legacyFrozen(cwd, [TASK3]);
    // A second frozen spec "newer" with a ticked list (empty) and a ticked task nobody gated.
    put(cwd, '.kiro/specs/newer/requirements.md', '# Requirements: newer\n');
    put(cwd, 'contracts/newer/a.contract.test.js', ALWAYS);
    put(cwd, '.kiro/specs/newer/tasks.md', '- [ ] 1. First (Req 1.1)\n');
    freezeSpec(cwd, 'newer');
    put(cwd, '.kiro/specs/newer/tasks.md', '- [x] 1. First (Req 1.1)\n');
    const res = handlePostTaskExec({ cwd });
    assert.equal(read(cwd, '.kiro/specs/newer/tasks.md'), '- [ ] 1. First (Req 1.1)\n', 'the newer spec is undone');
    assert.equal(read(cwd, TASKS_REL), tasksText([TASK3]), 'the legacy spec is left alone');
    assert.match(res.stderr, /Unticked "1\. First \(Req 1\.1\)"/);
    assert.equal((res.stderr.match(/freeze/gi) || []).length, 1, 'one freeze message, for demo');
  }));

test('R14.6 a lock with an empty ticked list is a recorded list: it is not the upgrade case', () =>
  temp((cwd) => {
    frozen(cwd, []);
    put(cwd, TASKS_REL, tasksText([TASK3]));
    const res = handlePostTaskExec({ cwd });
    assert.equal(read(cwd, TASKS_REL), tasksText());
    assert.doesNotMatch(res.stderr, /freeze the spec again/i);
  }));

// ---------------------------------------------------------------------------
// Req 14.1: freeze records which tasks are ticked
// ---------------------------------------------------------------------------

test('R14.1 freeze records the ticked task lines in the lock', () =>
  temp((cwd) => {
    frozen(cwd, [TASK2, TASK1]);
    assert.deepEqual(readLock(cwd).specs.demo.ticked, [TASK1, TASK2]);
    put(cwd, TASKS_REL, tasksText());
    freezeSpec(cwd, 'demo');
    assert.deepEqual(readLock(cwd).specs.demo.ticked, [], 'frozen again with nothing ticked');
  }));

// ---------------------------------------------------------------------------
// Req 14.5: CI and README
// ---------------------------------------------------------------------------

const REPO = path.join(import.meta.dirname, '..');

test('R14.5 the repository CI runs necro audit on every push, after the checkout', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /push:/);
  const steps = workflow.split(/\n\s+- name: /).slice(1);
  const audit = steps.findIndex((s) => /run:\s*node bin\/necro\.js audit\s*$/m.test(s));
  assert.ok(audit >= 0, 'a step runs node bin/necro.js audit');
  assert.match(steps[0], /actions\/checkout/);
});

test('R14.5 the README shows the one CI step a project adds to run necro audit', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const block = [...readme.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => /necro\S* audit|contract-necromancer audit/.test(b));
  assert.ok(block, 'a yaml block with the audit step');
  assert.match(block, /- name:/);
  assert.match(block, /run:\s*npx -y github:vijaygopalbalasa\/contract-necromancer audit/);
});
