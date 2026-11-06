// Contract for Requirement 2, criterion 9 (criteria in the formats Kiro writes) of the necro-core spec.
//
// A task names its criteria on its own line or on the indented lines under it, as `(Req 1.2, 3.1)` or as Kiro's
// `_Requirements: 1.2, 3.1_`. The test freezes a throwaway project whose tasks.md uses every format, reads the task
// table from the lock, and then ticks tasks through the gate to show that the recorded criteria decide which contracts
// are required.
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files that `necro freeze` and the gate use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/lock.js'
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

function pre(cwd, toolName, toolInput) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-criteria-format-'));
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

function lockOf(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
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

const REQ = `# Requirements: demo

## Requirement 1: Demo
### Acceptance criteria
1. WHEN a THE SYSTEM SHALL b.
2. WHEN c THE SYSTEM SHALL d.
3. WHEN e THE SYSTEM SHALL f.
`;

// R1.1 and R1.3 pass, R1.2 fails. A tick that is wrongly treated as "every contract" shows as a refusal naming R1.2.
const MIXED = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 failing contract', () => { assert.equal(1, 2); });
test('R1.3 other passing contract', () => { assert.ok(true); });
`;

// Every format, plus lines that must not be read.
const TASKS = [
  '# Tasks',
  '',
  '- [ ] 1. Kiro format on a sub-line',
  '  - Write the module.',
  '  - _Requirements: 1.1_',
  '- [ ] 2. Parenthesis on a sub-line',
  '    * (Req 1.2)',
  '- [ ] 3. Both on the line itself (Req 1.3) _Requirements: 1.1_',
  '- [ ] 4. Line and sub-lines together (Req 1.3)',
  '  - _Requirements: 1.1, 1.2_',
  '',
  '  - (Req 1.2, 1.3)',
  '- [ ] 5. Nothing of its own',
  '- [ ] 6. Later task (Req 1.2)',
  '  - _Requirements: 1.2_',
  '',
].join('\n');

test('R2.9 freeze reads criteria from the task line and from the indented sub-lines under it, in both formats', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/mixed.contract.test.js', MIXED);
    put(cwd, TASKS_REL, TASKS);
    const frozen = necro(cwd, ['freeze', 'demo']);
    assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);

    const { tasks } = lockOf(cwd).specs.demo;
    const criteria = (id) => [...tasks[id].criteria].sort();
    assert.deepEqual(criteria('1'), ['1.1'], '_Requirements: ..._ on a sub-line');
    assert.deepEqual(criteria('2'), ['1.2'], '(Req ...) on an indented sub-line');
    assert.deepEqual(criteria('3'), ['1.1', '1.3'], 'both formats on the task line');
    assert.deepEqual(criteria('4'), ['1.1', '1.2', '1.3'], 'line and sub-lines are united, a blank line does not end the task');
    assert.deepEqual(criteria('5'), [], 'criteria under a later task are not this task\'s');
    assert.deepEqual(criteria('6'), ['1.2']);
    assert.equal(tasks['1'].text, '1. Kiro format on a sub-line', 'the recorded text is the task line only');

    // The gate requires the contracts of the recorded criteria and no others.
    const tick = (line, id) => {
      const res = pre(cwd, 'fs_write', { path: TASKS_REL, text: TASKS.replace(`- [ ] ${line}`, `- [x] ${line}`) });
      return { res, id };
    };

    const one = tick('1. Kiro format on a sub-line', '1');
    assert.equal(one.res.status, 0, one.res.stderr);
    assert.deepEqual(receipts(cwd).find((r) => r.task && r.task.id === '1').required, ['R1.1 passing contract']);

    const three = tick('3. Both on the line itself (Req 1.3) _Requirements: 1.1_', '3');
    assert.equal(three.res.status, 0, three.res.stderr);
    assert.deepEqual(receipts(cwd).find((r) => r.task && r.task.id === '3').required, [
      'R1.1 passing contract',
      'R1.3 other passing contract',
    ]);

    const two = tick('2. Parenthesis on a sub-line', '2');
    assert.equal(two.res.status, 2, 'the sub-line names the failing R1.2, so the tick is refused');
    assert.match(two.res.stderr, /Contracts failed: R1\.2 failing contract\./);

    const four = tick('4. Line and sub-lines together (Req 1.3)', '4');
    assert.equal(four.res.status, 2, 'criteria on the sub-lines are required too');
    assert.match(four.res.stderr, /Contracts failed: R1\.2 failing contract\./);

    assert.equal(
      receipts(cwd).filter((r) => r.task && (r.task.id === '2' || r.task.id === '4')).length,
      0,
      'a refused tick writes no receipt',
    );
  }));
