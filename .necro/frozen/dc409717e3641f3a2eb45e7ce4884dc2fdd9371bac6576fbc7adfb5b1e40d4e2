// Contracts for Requirement 4 (gate on marking a task done): when the gate runs, what it answers and what it writes.
// R4.1 to R4.6, R4.13, R4.19, R4.20. Which contracts a tick requires is in required.contract.test.js, and how contract
// results are read is in runner.contract.test.js.
//
// Each test freezes a throwaway project in a temp directory and calls `necro hook pre` the way Kiro does. The hook
// never edits tasks.md, so a test can ask the gate several questions about one project by writing tasks.md itself
// between calls. This file carries its own helpers.
//
// The receipt pins the files the gate uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
//   from '../../src/contracts.js'
//   from '../../src/receipts.js'
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

function pre(cwd, toolName, toolInput) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-gate-'));
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

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

function receipts(cwd, spec = 'demo') {
  const dir = path.join(cwd, '.necro', 'receipts', spec);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({ file, receipt: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) }));
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const TASKS_REL = '.kiro/specs/demo/tasks.md';

const PASSING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
`;

const FAILING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.2 failing contract', () => { assert.equal(1, 2); });
`;

// R1.1 and R1.3 pass, R1.2 fails.
const MIXED = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 failing contract', () => { assert.equal(1, 2); });
test('R1.3 other passing contract', () => { assert.ok(true); });
`;

// Tasks with no "(Req ...)" criteria, so a tick requires every contract.
const TASKS_TWO = '- [ ] 1. Task one\n- [ ] 2. Task two\n';
const TICKED_ONE_OF_TWO = '- [x] 1. Task one\n- [ ] 2. Task two\n';

function frozen(cwd, contract, tasks = TASKS_TWO) {
  put(cwd, REQ_REL, '# Requirements: demo\n');
  put(cwd, 'contracts/demo/c.contract.test.js', contract);
  if (tasks !== null) put(cwd, TASKS_REL, tasks);
  freeze(cwd);
}

// The gate stopped the call because of the failing contract.
function assertGated(res, label) {
  assert.equal(res.status, 2, `${label}: expected the gate to stop it, got ${res.status}. stderr: ${res.stderr}`);
  assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./, label);
}

// The call is not a tick: allowed, with no output.
function assertQuiet(res, label) {
  assert.equal(res.status, 0, `${label}: expected exit 0, got ${res.status}. stderr: ${res.stderr}`);
  assert.equal(res.stdout, '', label);
  assert.equal(res.stderr, '', label);
}

test('R4.1 a str_replace on tasks.md is applied to the file on disk and gated when a task line changes from [ ] to [x]', () =>
  temp((cwd) => {
    frozen(cwd, FAILING);
    const edit = (oldStr, newStr, extra = {}) => ({ path: TASKS_REL, oldStr, newStr, ...extra });

    // Ticks.
    assertGated(pre(cwd, 'str_replace', edit('- [ ] 1. Task one', '- [x] 1. Task one')), 'plain tick');
    assertGated(pre(cwd, 'str_replace', edit('[ ] 1.', '[X] 1.')), 'capital X');
    assertGated(pre(cwd, 'str_replace', edit(' ] 2.', 'x] 2.')), 'edit inside the line');
    assertGated(pre(cwd, 'str_replace', edit('- [ ] 1. Task one', '- [x] 1. Task one, reworded')), 'tick and rename');
    assertGated(pre(cwd, 'str_replace', { ...edit('- [ ] 1.', '- [x] 1.'), path: path.join(cwd, TASKS_REL) }), 'absolute path');

    // One task unticked and another ticked in the same edit: the count stays the same, a line still went [ ] to [x].
    put(cwd, TASKS_REL, TICKED_ONE_OF_TWO);
    assertGated(
      pre(cwd, 'str_replace', edit(TICKED_ONE_OF_TWO, '- [ ] 1. Task one\n- [x] 2. Task two\n')),
      'swap',
    );

    // Not ticks.
    put(cwd, TASKS_REL, `${TASKS_TWO}Some notes\n`);
    assertQuiet(pre(cwd, 'str_replace', edit('Task two', 'Task 2')), 'rename');
    assertQuiet(pre(cwd, 'str_replace', edit('Some notes', 'Other [x] notes')), '[x] in a line that is not a task');
    put(cwd, TASKS_REL, TICKED_ONE_OF_TWO);
    assertQuiet(pre(cwd, 'str_replace', edit('- [x] 1.', '- [ ] 1.')), 'untick');
    assertQuiet(pre(cwd, 'str_replace', { path: 'src/notes.md', oldStr: '- [ ] 1.', newStr: '- [x] 1.' }), 'another file');
  }));

test('R4.2 an fs_write to tasks.md is compared line by line with the file on disk and gated when a task line changes from [ ] to [x]', () =>
  temp((cwd) => {
    frozen(cwd, FAILING);
    const write = (text, p = TASKS_REL) => ({ path: p, text });

    assertGated(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO)), 'tick');
    assertGated(pre(cwd, 'fs_write', write('- [x] 1. Task one v2\n- [ ] 2. Task two\n')), 'tick and rename');
    assertGated(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO, path.join(cwd, TASKS_REL))), 'absolute path');

    // A file with CRLF line ends, written back with LF.
    put(cwd, TASKS_REL, '- [ ] 1. Task one\r\n- [ ] 2. Task two\r\n');
    assertGated(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO)), 'CRLF on disk');
    put(cwd, TASKS_REL, '- [x] 1. Task one\r\n- [ ] 2. Task two\r\n');
    assertQuiet(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO)), 'CRLF on disk, same ticks');

    // One task unticked and another ticked.
    put(cwd, TASKS_REL, TICKED_ONE_OF_TWO);
    assertGated(pre(cwd, 'fs_write', write('- [ ] 1. Task one\n- [x] 2. Task two\n')), 'swap');

    // Not ticks: the same ticks, fewer ticks, a [x] in text that is not a task line.
    assertQuiet(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO)), 'same content');
    assertQuiet(pre(cwd, 'fs_write', write(TASKS_TWO)), 'untick');
    assertQuiet(pre(cwd, 'fs_write', write(`${TICKED_ONE_OF_TWO}Notes about [x] marks\n`)), '[x] in notes');
    assertQuiet(pre(cwd, 'fs_write', write(TICKED_ONE_OF_TWO, 'src/notes.md')), 'another file');
  }));

test('R4.3 marking a task done in a spec that is not frozen exits 2 and says the spec must be frozen first', () => {
  // No lock at all.
  temp((cwd) => {
    put(cwd, REQ_REL, '# Requirements: demo\n');
    put(cwd, 'contracts/demo/c.contract.test.js', PASSING);
    put(cwd, TASKS_REL, TASKS_TWO);
    const res = pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /not frozen/);
    assert.match(res.stderr, /freeze/);
    assert.ok(res.stderr.includes('demo'), `names the spec: ${res.stderr}`);
    assert.equal(fs.readFileSync(path.join(cwd, TASKS_REL), 'utf8'), TASKS_TWO);
  });

  // Another spec is frozen, this one is not.
  temp((cwd) => {
    frozen(cwd, PASSING);
    put(cwd, '.kiro/specs/other/tasks.md', TASKS_TWO);
    const res = pre(cwd, 'fs_write', { path: '.kiro/specs/other/tasks.md', text: '- [x] 1. Task one\n- [ ] 2. Task two\n' });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /not frozen/);
    assert.ok(res.stderr.includes('other'), res.stderr);
    assert.deepEqual(receipts(cwd, 'other'), []);
  });
});

test('R4.4 the gate runs the spec\'s frozen contracts itself, under the Node test runner, for every tick', () =>
  temp((cwd) => {
    // The contract leaves a line in runs.txt each time it runs, saying whether the Node test runner started it.
    frozen(
      cwd,
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R1.1 marked contract', () => {
  fs.appendFileSync(new URL('../../runs.txt', import.meta.url), typeof process.env.NODE_TEST_CONTEXT + '\\n');
  assert.ok(true);
});
`,
    );
    const runs = () => fs.readFileSync(path.join(cwd, 'runs.txt'), 'utf8').split('\n').filter(Boolean);
    assert.equal(runs().length, 1, 'freeze ran the contract once');

    const tick = { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' };
    assert.equal(pre(cwd, 'str_replace', tick).status, 0);
    assert.equal(runs().length, 2, 'the gate ran the contract');
    assert.equal(pre(cwd, 'str_replace', tick).status, 0);
    assert.equal(runs().length, 3, 'and runs it again for the next tick');
    assert.deepEqual([...new Set(runs())], ['string'], 'each run was started by the Node test runner');

    // A call that ticks nothing does not run the contracts.
    assert.equal(pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: 'Task two', newStr: 'Task 2' }).status, 0);
    assert.equal(runs().length, 3);
  }));

test('R4.5 when a required contract fails the gate exits 2 and lists each failing required contract by name', () =>
  temp((cwd) => {
    frozen(
      cwd,
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 first failing contract', () => { assert.equal(1, 2); });
test('R1.3 second failing contract', () => { assert.fail('no'); });
`,
    );
    const res = pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' });
    assert.equal(res.status, 2, res.stderr);
    assert.ok(res.stderr.includes('R1.2 first failing contract'), res.stderr);
    assert.ok(res.stderr.includes('R1.3 second failing contract'), res.stderr);
    assert.ok(!res.stderr.includes('R1.1 passing contract'), 'a passing contract is not listed');
    assert.doesNotMatch(res.stderr, /Hook error/);
    assert.deepEqual(receipts(cwd), [], 'no receipt when the gate says no');
  }));

test('R4.6 when all contracts pass the gate writes a receipt to .necro/receipts/<spec>/<receiptHash>.json and exits 0', () =>
  temp((cwd) => {
    frozen(cwd, MIXED.replace("assert.equal(1, 2)", 'assert.ok(true)'));
    const res = pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, '');

    const written = receipts(cwd);
    assert.equal(written.length, 1, 'one receipt');
    const { file, receipt } = written[0];
    assert.match(receipt.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(file, `${receipt.receiptHash}.json`, 'the file is named after its receiptHash');
    assert.equal(receipt.spec, 'demo');
    assert.deepEqual(
      receipt.contracts.map((c) => c.result),
      ['pass', 'pass', 'pass'],
    );
  }));

test('R4.13 a write to a tasks.md that leaves more [x] task lines than the file on disk is gated, even when no line matches an earlier [ ] line', () => {
  // The file does not exist yet.
  temp((cwd) => {
    frozen(cwd, FAILING, null);
    assertGated(pre(cwd, 'fs_write', { path: TASKS_REL, text: '- [x] 1. Task one\n' }), 'new file');
    assertGated(pre(cwd, 'fs_append', { path: TASKS_REL, text: '- [x] 1. Task one\n' }), 'append to a missing file');
  });

  temp((cwd) => {
    frozen(cwd, FAILING);

    // A ticked line is added with no matching unticked line before it.
    assertGated(pre(cwd, 'fs_write', { path: TASKS_REL, text: `${TASKS_TWO}- [x] 3. Task three, never listed\n` }), 'added ticked line');
    assertGated(pre(cwd, 'fs_append', { path: TASKS_REL, text: '- [x] 3. Task three\n' }), 'appended ticked line');

    // Task lines without a list marker are task lines.
    for (const line of ['[x] 1. Task one', '-[x] 1. Task one', '  [X] 1. Task one']) {
      assertGated(pre(cwd, 'fs_write', { path: TASKS_REL, text: `${line}\n` }), JSON.stringify(line));
    }
    put(cwd, TASKS_REL, '[ ] 1. Task one\n');
    assertGated(pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '[ ] 1.', newStr: '[x] 1.' }), 'bare box');

    // An edit that does not apply to the file on disk is judged by the [x] marks in the edit itself.
    put(cwd, TASKS_REL, '- [ ]  1. Task one\n');
    assertGated(pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: '[ ] 1.', newStr: '[x] 1.' }), 'edit that does not apply');

    // Writes that do not raise the number of [x] task lines stay quiet.
    put(cwd, TASKS_REL, TICKED_ONE_OF_TWO);
    assertQuiet(pre(cwd, 'fs_write', { path: TASKS_REL, text: `${TICKED_ONE_OF_TWO}Notes about [x] marks\n` }), 'notes');
    assertQuiet(pre(cwd, 'fs_write', { path: TASKS_REL, text: TASKS_TWO }), 'untick');
    assertQuiet(pre(cwd, 'str_replace', { path: TASKS_REL, oldStr: 'Task two', newStr: 'Task 2' }), 'rename');
  });
});

// -- Requirement 4.19 and 4.20: the Kiro IDE's task tool ----------------------------------------------------------

// task_update's input is { tasksFilePath, taskId, status, error }. taskId is the task line text after the checkbox.
const TU_ONE = '1. Implement `slugify` in `src/slugify.js` (Req 1.1)'; // R1.1 passes
const TU_TWO = '2. Reject empty input (Req 1.2)'; // R1.2 fails
const TU_THREE = '3. Trim surrounding whitespace (Req 1.3)'; // R1.3 passes
const TU_TASKS = [TU_ONE, TU_TWO, TU_THREE].map((t) => `- [ ] ${t}`).join('\n') + '\n';

function taskUpdate(cwd, input) {
  return pre(cwd, 'task_update', {
    tasksFilePath: path.join(cwd, TASKS_REL),
    status: 'completed',
    error: '',
    ...input,
  });
}

test('R4.19 task_update with status completed is gated like a tick written to tasks.md, with the same exit codes, messages and receipt', () =>
  temp((cwd) => {
    frozen(cwd, MIXED, TU_TASKS);

    // A failing required contract: exit 2 and the same message as for a tick in the file.
    const failing = taskUpdate(cwd, { taskId: TU_TWO });
    assert.equal(failing.status, 2, failing.stderr);
    assert.equal(failing.stderr.trim(), 'Contracts failed: R1.2 failing contract.');
    assert.deepEqual(receipts(cwd), []);

    // Passing required contracts: exit 0 and a receipt for that task.
    const passing = taskUpdate(cwd, { taskId: TU_ONE });
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(passing.stderr, '');
    const [{ receipt }] = receipts(cwd);
    assert.deepEqual(receipt.task, { id: '1', line: TU_ONE });
    assert.deepEqual(receipt.required, ['R1.1 passing contract']);
    assert.equal(receipt.contracts.find((c) => c.name === 'R1.2 failing contract').result, 'fail', 'every result is recorded');
    assert.equal(fs.readFileSync(path.join(cwd, TASKS_REL), 'utf8'), TU_TASKS, 'the hook does not edit tasks.md');

    // The path may be relative to the project, the status may be written in any letter case.
    const relative = taskUpdate(cwd, { tasksFilePath: TASKS_REL, taskId: TU_TWO, status: 'Completed' });
    assert.equal(relative.status, 2);
    assert.match(relative.stderr, /R1\.2 failing contract/);

    // Other statuses are not a completion, even while a contract fails.
    for (const status of ['in_progress', 'queued', 'task_list']) {
      assertQuiet(taskUpdate(cwd, { taskId: TU_TWO, status }), status);
    }
    assertQuiet(pre(cwd, 'task_update', { tasksFilePath: path.join(cwd, TASKS_REL), status: 'task_list' }), 'task_list without a taskId');

    // A spec that is not frozen: exit 2 and the same message as for a tick in the file.
    put(cwd, '.kiro/specs/other/requirements.md', '# Requirements: other\n');
    put(cwd, '.kiro/specs/other/tasks.md', TU_TASKS);
    const unfrozen = pre(cwd, 'task_update', {
      tasksFilePath: path.join(cwd, '.kiro/specs/other/tasks.md'),
      taskId: TU_ONE,
      status: 'completed',
    });
    assert.equal(unfrozen.status, 2, unfrozen.stderr);
    assert.match(unfrozen.stderr, /not frozen/);
    assert.match(unfrozen.stderr, /freeze/);
    assert.ok(unfrozen.stderr.includes('other'));
  }));

test('R4.20 a task_update to completed that names no task line requires every contract; a path outside the project is blocked', () => {
  temp((cwd) => {
    frozen(cwd, MIXED, TU_TASKS);
    for (const taskId of [
      '1. Implement something else (Req 1.1)',
      '1. Implement `slugify` in `src/slugify.js`',
      '9. A task nobody wrote (Req 1.1)',
      '',
    ]) {
      const res = taskUpdate(cwd, { taskId });
      assert.equal(res.status, 2, JSON.stringify(taskId));
      assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./, JSON.stringify(taskId));
    }
    assert.deepEqual(receipts(cwd), []);

    // A tasksFilePath outside the project, or one that is not a spec's tasks.md, names no spec.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-elsewhere-'));
    try {
      const foreign = path.join(elsewhere, '.kiro', 'specs', 'demo', 'tasks.md');
      fs.mkdirSync(path.dirname(foreign), { recursive: true });
      fs.writeFileSync(foreign, TU_TASKS);
      for (const tasksFilePath of [foreign, `../${path.basename(elsewhere)}/.kiro/specs/demo/tasks.md`, 'README.md', '']) {
        const res = taskUpdate(cwd, { tasksFilePath, taskId: TU_ONE });
        assert.equal(res.status, 2, JSON.stringify(tasksFilePath));
        assert.notEqual(res.stderr.trim(), '', JSON.stringify(tasksFilePath));
        assert.doesNotMatch(res.stderr, /Hook error/);
      }
      // A link to a tasks.md outside the project is outside the project.
      const link = path.join(cwd, '.kiro', 'specs', 'linked', 'tasks.md');
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(foreign, link);
      assert.equal(taskUpdate(cwd, { tasksFilePath: link, taskId: TU_ONE }).status, 2, 'symbolic link');
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  // With every contract passing, an unknown task is allowed and the receipt names no task.
  temp((cwd) => {
    frozen(cwd, PASSING, TU_TASKS);
    const res = taskUpdate(cwd, { taskId: '9. A task nobody wrote' });
    assert.equal(res.status, 0, res.stderr);
    const [{ receipt }] = receipts(cwd);
    assert.equal(receipt.task, null);
    assert.deepEqual(receipt.required, ['R1.1 passing contract']);
  });
});
