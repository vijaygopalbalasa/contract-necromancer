// Contracts for Requirement 4 (gate on marking a task done): which contracts a tick requires.
// R4.14, R4.15, R4.16, R4.17, R4.18.
//
// The gate runs every frozen contract and requires only those that belong to the ticked task, named by the criteria
// the lock recorded at freeze. Whenever that cannot be trusted, every contract is required. The fixture contract has
// one failing contract, R1.2, so "every contract is required" shows as a refusal that names it.
//
// Each test freezes a throwaway project once and asks the gate several questions about it by writing tasks.md between
// calls (the hook never edits tasks.md, and the lock keeps what was frozen). This file carries its own helpers.
//
// The receipt pins the files the gate uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
//   from '../../src/lock.js'
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-required-'));
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

function receipts(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const TASKS_REL = '.kiro/specs/demo/tasks.md';

// R1.1 and R1.3 pass, R1.2 fails.
const MIXED = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 failing contract', () => { assert.equal(1, 2); });
test('R1.3 other passing contract', () => { assert.ok(true); });
`;

const T1 = '- [ ] 1. Task one (Req 1.1)';
const T2 = '- [ ] 2. Task two (Req 1.2)';
const T3 = '- [ ] 3. Task three (Req 1.3)';
const T4 = '- [ ] 4. Task four (Req 1.1, 1.2)';
const T5 = '- [ ] 5. Task five';
const T6 = '- [ ] 6. Task six (Req 7.7)';
const TASKS_MIXED = [T1, T2, T3, T4, T5, T6, ''].join('\n');
const tick = (line) => line.replace('[ ]', '[x]');
const lines = (...l) => [...l, ''].join('\n');

// Freezes "demo" with the MIXED contract file and the tasks that tasks.md has at freeze time.
function mixedProject(cwd, tasksAtFreeze = TASKS_MIXED) {
  put(cwd, REQ_REL, '# Requirements: demo\n');
  put(cwd, 'contracts/demo/mixed.contract.test.js', MIXED);
  put(cwd, TASKS_REL, tasksAtFreeze);
  freeze(cwd);
}

const replace = (oldStr, newStr) => ({ path: TASKS_REL, oldStr, newStr });
const write = (text) => ({ path: TASKS_REL, text });

// The gate required every contract, so the failing R1.2 stops the tick.
function assertAllRequired(cwd, tool, input, label) {
  const res = pre(cwd, tool, input);
  assert.equal(res.status, 2, `${label}: every contract should be required, but the gate said ${res.status}. ${res.stderr}`);
  assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./, label);
  assert.doesNotMatch(res.stderr, /Hook error/, label);
}

test('R4.14 a tick requires the contracts whose names start with a criterion the lock records for that task id', () => {
  temp((cwd) => {
    mixedProject(cwd);

    // Task 1 names Req 1.1. R1.2 fails but is not required, so the tick is allowed and the receipt says what was required.
    const res = pre(cwd, 'str_replace', replace(T1, tick(T1)));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, '');
    const [receipt] = receipts(cwd);
    assert.deepEqual(receipt.required, ['R1.1 passing contract']);
    assert.deepEqual(
      Object.fromEntries(receipt.contracts.map((c) => [c.name, c.result])),
      { 'R1.1 passing contract': 'pass', 'R1.2 failing contract': 'fail', 'R1.3 other passing contract': 'pass' },
      'every contract that ran is still recorded',
    );

    // The same through fs_write, for a different task.
    const viaWrite = pre(cwd, 'fs_write', write(TASKS_MIXED.replace(T3, tick(T3))));
    assert.equal(viaWrite.status, 0, viaWrite.stderr);
    assert.deepEqual(receipts(cwd).map((r) => r.required).sort(), [['R1.1 passing contract'], ['R1.3 other passing contract']]);

    // A task that names the failing criterion is refused, and only the failing required contract is listed.
    const refused = pre(cwd, 'str_replace', replace(T2, tick(T2)));
    assert.equal(refused.status, 2);
    assert.equal(refused.stderr.trim(), 'Contracts failed: R1.2 failing contract.');

    // A task that names several criteria requires the contracts of all of them.
    const several = pre(cwd, 'str_replace', replace(T4, tick(T4)));
    assert.equal(several.status, 2);
    assert.match(several.stderr, /R1\.2 failing contract/);
    assert.ok(!several.stderr.includes('R1.1'), 'a passing required contract is not listed');
    assert.equal(receipts(cwd).length, 2, 'refused ticks leave no receipt');
  });

  // A criterion matches a name only up to a space or the end of the name: R1.1 is not R1.10 or R1.12.
  temp((cwd) => {
    put(cwd, REQ_REL, '# Requirements: demo\n');
    put(
      cwd,
      'contracts/demo/names.contract.test.js',
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1', () => { assert.ok(true); });
test('R1.1 with a description', () => { assert.ok(true); });
test('R1.10 is another criterion', () => { assert.equal(1, 2); });
test('R1.12 is another criterion too', () => { assert.equal(1, 2); });
`,
    );
    put(cwd, TASKS_REL, '- [ ] 1. One (Req 1.1)\n- [ ] 2. Two (Req 1.10)\n');
    freeze(cwd);
    const res = pre(cwd, 'str_replace', replace('- [ ] 1. One (Req 1.1)', '- [x] 1. One (Req 1.1)'));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(receipts(cwd)[0].required, ['R1.1', 'R1.1 with a description']);
  });
});

test('R4.15 every contract is required when the ticked task cannot be tied to the criteria the lock recorded', () =>
  temp((cwd) => {
    mixedProject(cwd);

    // The line now names different criteria than the lock records: changed, dropped, or added.
    assertAllRequired(cwd, 'str_replace', replace(T2, '- [x] 2. Task two (Req 1.1)'), 'criteria changed');
    assertAllRequired(cwd, 'fs_write', write(TASKS_MIXED.replace(T2, '- [x] 2. Task two (Req 1.1)')), 'criteria changed, fs_write');
    assertAllRequired(cwd, 'str_replace', replace(T2, '- [x] 2. Task two'), 'criteria dropped');
    assertAllRequired(cwd, 'str_replace', replace(T1, '- [x] 1. Task one (Req 1.1, 2.2)'), 'criterion added');

    // The task id is not in the lock: a task added after freeze, and an id that was renamed while ticking.
    const late = '- [ ] 9. Late task (Req 1.1)';
    put(cwd, TASKS_REL, `${TASKS_MIXED}${late}\n`);
    assertAllRequired(cwd, 'str_replace', replace(late, tick(late)), 'id not in the lock');
    put(cwd, TASKS_REL, TASKS_MIXED);
    assertAllRequired(cwd, 'str_replace', replace(T1, '- [x] 77. Task one (Req 1.1)'), 'id renamed');

    // The lock records no criteria for the task, or no contract matches them.
    assertAllRequired(cwd, 'str_replace', replace(T5, tick(T5)), 'no criteria recorded');
    assertAllRequired(cwd, 'str_replace', replace(T6, tick(T6)), 'no contract matches');

    // It is the last unticked task of the spec.
    put(cwd, TASKS_REL, lines(T1, tick(T2), tick(T3), tick(T4), tick(T5), tick(T6)));
    assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), 'last unticked task');

    // The control: an untouched line of an open task still gets the narrow set.
    put(cwd, TASKS_REL, TASKS_MIXED);
    assert.equal(pre(cwd, 'str_replace', replace(T1, tick(T1))).status, 0);
    assert.equal(receipts(cwd).length, 1, 'only the control wrote a receipt');
  }));

test('R4.16 every contract is required when the ticked line, the id or the unticked tasks cannot be trusted', () =>
  temp((cwd) => {
    mixedProject(cwd);

    // The text after the checkbox differs from the text the lock records for the id.
    assertAllRequired(
      cwd,
      'str_replace',
      replace(T1, '- [x] 1. Quietly pretend the hard work is done (Req 1.1)'),
      'reworded, str_replace',
    );
    assertAllRequired(cwd, 'fs_write', write(TASKS_MIXED.replace(T1, '- [x] 1. Task one, reworded (Req 1.1)')), 'reworded, fs_write');

    // The id appears on more than one line: a copy already on disk, and a ticked copy added by the write.
    put(cwd, TASKS_REL, `${TASKS_MIXED}${T1}\n`);
    assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), 'copy on disk');
    put(cwd, TASKS_REL, TASKS_MIXED);
    assertAllRequired(cwd, 'fs_write', write(`${TASKS_MIXED}${tick(T1)}\n`), 'ticked copy added');

    // After the tick every task the lock records is ticked or missing. Lines added later do not keep it open.
    const late = '- [ ] 9. Late task added after freeze (Req 1.1)';
    put(cwd, TASKS_REL, lines(T1, tick(T2), tick(T3), tick(T4), tick(T5), tick(T6), late));
    assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), 'only an added line is left unticked');
    put(cwd, TASKS_REL, lines(T1, tick(T2), tick(T3), tick(T4), tick(T5), tick(T6)));
    assertAllRequired(cwd, 'fs_write', write(lines(tick(T1), tick(T2), tick(T3), tick(T4), tick(T5), tick(T6), late)), 'fs_write adds one');

    // A frozen task whose line was removed counts as missing.
    put(cwd, TASKS_REL, lines(T1, tick(T3), tick(T4), tick(T5), tick(T6)));
    assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), 'frozen line removed');
  }));

test('R4.17 a contract file that holds a required contract and fails as a whole fails the tick', () => {
  const badExit = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passes on its own', () => { assert.ok(true); });
test('R1.2 also passes on its own', () => { assert.ok(true); });
process.exitCode = 1;
`;
  const healthy = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R2.1 passes in a healthy file', () => { assert.ok(true); });
test('R2.2 passes too', () => { assert.ok(true); });
`;
  const U1 = '- [ ] 1. First (Req 1.1)';
  const U2 = '- [ ] 2. Second (Req 2.1)';
  const U3 = '- [ ] 3. Third (Req 2.2)';

  // Every test of a.contract.test.js passes, but the file exits with a failure code.
  temp((cwd) => {
    put(cwd, REQ_REL, '# Requirements: demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', badExit);
    put(cwd, 'contracts/demo/b.contract.test.js', healthy);
    put(cwd, TASKS_REL, lines(U1, U2, U3));
    freeze(cwd);

    const blocked = pre(cwd, 'str_replace', replace(U1, tick(U1)));
    assert.equal(blocked.status, 2, 'R1.1 passed on its own, the file as a whole did not');
    assert.match(blocked.stderr, /Contracts failed: .*\ba\b/);
    assert.deepEqual(receipts(cwd), []);

    // A task whose required contracts are in the healthy file is not held back by the broken file.
    const allowed = pre(cwd, 'str_replace', replace(U2, tick(U2)));
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.deepEqual(receipts(cwd)[0].required, ['R2.1 passes in a healthy file']);
  });

  // A contract file that no longer loads because something it imports broke.
  temp((cwd) => {
    put(cwd, REQ_REL, '# Requirements: demo\n');
    put(cwd, 'src/dep.js', 'export const ok = true;\n');
    put(
      cwd,
      'contracts/demo/dep.contract.test.js',
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok } from '../../src/dep.js';
test('R1.1 uses the dependency', () => { assert.equal(ok, true); });
`,
    );
    put(cwd, 'contracts/demo/b.contract.test.js', healthy);
    put(cwd, TASKS_REL, lines(U1, U2, U3));
    freeze(cwd);
    put(cwd, 'src/dep.js', 'throw new Error("broken at load");\n');

    const res = pre(cwd, 'str_replace', replace(U1, tick(U1)));
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /R1\.1 uses the dependency/);
    assert.deepEqual(receipts(cwd), []);
  });
});

test('R4.18 only an unticked line on exactly one line with the frozen text counts as a frozen task that is still unticked', () =>
  temp((cwd) => {
    mixedProject(cwd);
    const allDoneButOne = [tick(T2), tick(T3), tick(T4), tick(T5), tick(T6)];

    // Task 1 is the last frozen task left unticked. Each decoy borrows a frozen id and cannot keep a task open.
    const decoys = [
      '- [ ] 3. Something else entirely (Req 1.3)', // a frozen id with other text
      T3, // a second, unticked copy of a frozen line
    ];
    for (const decoy of decoys) {
      put(cwd, TASKS_REL, lines(T1, ...allDoneButOne, decoy));
      assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), `decoy ${decoy}, str_replace`);
      assertAllRequired(cwd, 'fs_write', write(lines(tick(T1), ...allDoneButOne, decoy)), `decoy ${decoy}, fs_write`);
    }

    // A frozen task whose line was reworded no longer counts as open either.
    put(cwd, TASKS_REL, lines(T1, '- [ ] 2. Task two, reworded (Req 1.2)', tick(T3), tick(T4), tick(T5), tick(T6)));
    assertAllRequired(cwd, 'str_replace', replace(T1, tick(T1)), 'reworded open task');

    // The control: task 2 is a genuinely open frozen task (one line, frozen text), so a decoy next to it changes nothing
    // and ticking task 1 requires only its own criteria.
    put(cwd, TASKS_REL, lines(T1, T2, tick(T3), tick(T4), tick(T5), tick(T6), decoys[0]));
    const res = pre(cwd, 'str_replace', replace(T1, tick(T1)));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(receipts(cwd).map((r) => r.required), [['R1.1 passing contract']]);
  }));
