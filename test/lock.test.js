import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/canon.js';
import {
  readLock, writeLock, freezeSpec, isSpecFrozen, isFrozenPath,
  frozenFiles, getExpectedHash,
} from '../src/lock.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const REQ = fs.readFileSync(path.join(FIXTURES, 'requirements.md'), 'utf8');
const CONTRACT = fs.readFileSync(path.join(FIXTURES, 'hello.contract.test.js'), 'utf8');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-lock-'));
}

function writeReq(cwd, spec, content) {
  const dir = path.join(cwd, '.kiro', 'specs', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements.md'), content);
}

function writeContract(cwd, spec, name, content) {
  const dir = path.join(cwd, 'contracts', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

test('R2.1 freezeSpec records sha256 of requirements and each contract in lock.json', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    freezeSpec(cwd, 'demo');

    const lock = readLock(cwd);
    assert.ok(lock.specs.demo, 'spec entry present');
    assert.equal(lock.specs.demo.requirements.path, '.kiro/specs/demo/requirements.md');
    assert.equal(lock.specs.demo.requirements.sha256, sha256(REQ));

    const contractPath = 'contracts/demo/hello.contract.test.js';
    const c = lock.specs.demo.contracts.find((x) => x.path === contractPath);
    assert.ok(c, 'contract entry present');
    assert.equal(c.sha256, sha256(CONTRACT));
    assert.equal(c.name, 'hello');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.2 freezeSpec stores a copy of each frozen file at .necro/frozen/<sha256>', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    freezeSpec(cwd, 'demo');

    const lock = readLock(cwd);
    const frozenDir = path.join(cwd, '.necro', 'frozen');

    assert.equal(
      fs.readFileSync(path.join(frozenDir, lock.specs.demo.requirements.sha256), 'utf8'),
      REQ,
    );
    for (const c of lock.specs.demo.contracts) {
      assert.equal(fs.readFileSync(path.join(frozenDir, c.sha256), 'utf8'), CONTRACT);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.3 freezeSpec refuses with a plain message when there are no contract files', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    // no contract files written
    assert.throws(
      () => freezeSpec(cwd, 'demo'),
      /No contracts found for spec 'demo'. Add at least one file in contracts\/demo\//,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.4 re-freezing replaces the spec entry and keeps other specs', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'alpha', '# Alpha v1\n');
    writeContract(cwd, 'alpha', 'a.contract.test.js', CONTRACT);
    writeReq(cwd, 'beta', '# Beta v1\n');
    writeContract(cwd, 'beta', 'b.contract.test.js', CONTRACT);

    freezeSpec(cwd, 'alpha');
    freezeSpec(cwd, 'beta');

    // re-freeze alpha after changing its requirements
    writeReq(cwd, 'alpha', '# Alpha v2\n');
    freezeSpec(cwd, 'alpha');

    const lock = readLock(cwd);
    assert.equal(lock.specs.alpha.requirements.sha256, sha256('# Alpha v2\n'));
    assert.equal(lock.specs.alpha.requirements.path, '.kiro/specs/alpha/requirements.md');
    // beta untouched
    assert.equal(lock.specs.beta.requirements.sha256, sha256('# Beta v1\n'));
    assert.equal(lock.specs.beta.contracts[0].path, 'contracts/beta/b.contract.test.js');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('query helpers: isSpecFrozen, isFrozenPath, frozenFiles, getExpectedHash', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);

    assert.equal(isSpecFrozen(cwd, 'demo'), false);
    freezeSpec(cwd, 'demo');
    assert.equal(isSpecFrozen(cwd, 'demo'), true);
    assert.equal(isSpecFrozen(cwd, 'other'), false);

    assert.equal(isFrozenPath(cwd, '.kiro/specs/demo/requirements.md'), true);
    assert.equal(isFrozenPath(cwd, 'contracts/demo/hello.contract.test.js'), true);
    assert.equal(isFrozenPath(cwd, 'src/canon.js'), false);

    assert.equal(getExpectedHash(cwd, '.kiro/specs/demo/requirements.md'), sha256(REQ));
    assert.equal(getExpectedHash(cwd, 'contracts/demo/hello.contract.test.js'), sha256(CONTRACT));
    assert.equal(getExpectedHash(cwd, 'src/canon.js'), null);

    assert.deepEqual(
      frozenFiles(cwd, 'demo').map((f) => f.path).sort(),
      ['.kiro/specs/demo/requirements.md', 'contracts/demo/hello.contract.test.js'],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeLock then readLock round-trips and sorts keys', () => {
  const cwd = tmpCwd();
  try {
    writeLock(cwd, { specs: { zeta: { frozenAt: 'x', requirements: { path: 'r', sha256: 'h' } } } });
    const lock = readLock(cwd);
    assert.equal(lock.specs.zeta.requirements.path, 'r');
    // raw file has 2-space indent (pretty printed)
    const raw = fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8');
    assert.ok(raw.includes('\n  "specs"'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.5 freeze runs the contracts and records the name of every contract in the lock', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    freezeSpec(cwd, 'demo');

    const lock = readLock(cwd);
    const c = lock.specs.demo.contracts.find((x) => x.path === 'contracts/demo/hello.contract.test.js');
    assert.ok(c, 'contract entry present');
    assert.ok(Array.isArray(c.names), 'contract names recorded in the lock');
    assert.ok(
      c.names.includes('demo contract'),
      `names include the contract test name: ${JSON.stringify(c.names)}`,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.6 a contract path that resolves outside the project root is refused at freeze', () => {
  const cwd = tmpCwd();
  let outside = null;
  try {
    writeReq(cwd, 'demo', REQ);
    // Put the real file outside the project root, then symlink it in.
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-outside-'));
    const outsideFile = path.join(outside, 'evil.contract.test.js');
    fs.writeFileSync(outsideFile, CONTRACT);
    const contractsDir = path.join(cwd, 'contracts', 'demo');
    fs.mkdirSync(contractsDir, { recursive: true });
    fs.symlinkSync(outsideFile, path.join(contractsDir, 'evil.contract.test.js'));

    assert.throws(
      () => freezeSpec(cwd, 'demo'),
      /outside the project root/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 12: freeze records each task id with its criteria (Req 2.7)
// ---------------------------------------------------------------------------

function writeTasksFile(cwd, spec, content) {
  const dir = path.join(cwd, '.kiro', 'specs', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks.md'), content);
}

function freezeWithTasks(tasksText) {
  const cwd = tmpCwd();
  writeReq(cwd, 'demo', REQ);
  writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
  if (tasksText !== null) writeTasksFile(cwd, 'demo', tasksText);
  freezeSpec(cwd, 'demo');
  return cwd;
}

test('R2.7 freeze records each task id with the criteria its line names', () => {
  const cwd = freezeWithTasks(
    [
      '# Tasks',
      '',
      '- [x] 1. **Scaffold** (Req 1.1, 1.2, 1.3)',
      '  - Test first: a sub-bullet with (Req 9.9) is not a task line.',
      '- [ ] 8b. **Hardening** (Req 4.11, 6.4)',
      '- [ ] 3. **Runner** (supports Req 4.4, 4.5, 6.1)',
      '',
    ].join('\n'),
  );
  try {
    const lock = readLock(cwd);
    assert.deepEqual(lock.specs.demo.tasks['1'].criteria, ['1.1', '1.2', '1.3']);
    assert.deepEqual(lock.specs.demo.tasks['8b'].criteria, ['4.11', '6.4']);
    assert.deepEqual(lock.specs.demo.tasks['3'].criteria, ['4.4', '4.5', '6.1']);
    assert.deepEqual(Object.keys(lock.specs.demo.tasks).sort(), ['1', '3', '8b']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.7 the task id is the text before the first dot, and criteria are sorted and unique', () => {
  const cwd = freezeWithTasks(
    '- [ ] 12. Do it (Req 4.15, 2.7, 4.5, 2.7)\n* [ ] 3c. Other (Req 2.5)\n[ ] 4. Bare box (Req 5.1)\n',
  );
  try {
    const lock = readLock(cwd);
    assert.deepEqual(lock.specs.demo.tasks['12'].criteria, ['2.7', '4.5', '4.15']);
    assert.deepEqual(lock.specs.demo.tasks['3c'].criteria, ['2.5']);
    assert.deepEqual(lock.specs.demo.tasks['4'].criteria, ['5.1']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.7 a task whose line names no criteria is recorded with an empty list; parentheses without Req are ignored', () => {
  const cwd = freezeWithTasks('- [ ] 1. Plain task\n- [ ] 2. Other task (see 3.4 in the design)\n');
  try {
    const lock = readLock(cwd);
    assert.deepEqual(lock.specs.demo.tasks['1'].criteria, []);
    assert.deepEqual(lock.specs.demo.tasks['2'].criteria, []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.7 a task line without a dot has no id and is not recorded; an id used twice is recorded with no criteria', () => {
  const cwd = freezeWithTasks(
    '- [ ] Task without a number\n- [ ] 5. First five (Req 1.1)\n- [ ] 5. Second five (Req 1.2)\n- [ ] 6. Six (Req 1.3)\n',
  );
  try {
    const lock = readLock(cwd);
    assert.deepEqual(Object.keys(lock.specs.demo.tasks).sort(), ['5', '6']);
    assert.deepEqual(lock.specs.demo.tasks['5'].criteria, [], 'an ambiguous id requires everything');
    assert.deepEqual(lock.specs.demo.tasks['6'].criteria, ['1.3']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.7 a spec with no tasks.md freezes with an empty task table', () => {
  const cwd = freezeWithTasks(null);
  try {
    assert.deepEqual(readLock(cwd).specs.demo.tasks, {});
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.7 re-freezing replaces the task table of that spec', () => {
  const cwd = freezeWithTasks('- [ ] 1. One (Req 1.1)\n');
  try {
    writeTasksFile(cwd, 'demo', '- [ ] 2. Two (Req 1.2)\n');
    freezeSpec(cwd, 'demo');
    assert.deepEqual(Object.keys(readLock(cwd).specs.demo.tasks), ['2']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 13: freeze records each task's line text (Req 2.8)
// ---------------------------------------------------------------------------

test('R2.8 freeze records the text after the checkbox of each task line, ticked or not', () => {
  const cwd = freezeWithTasks(
    [
      '- [x] 1. **Scaffold** (Req 1.1, 1.2)',
      '  - [ ] 9. A sub-bullet checkbox is a task line too (Req 9.9)',
      '* [ ] 8b. **Hardening**   (Req 4.11)  ',
      '[ ] 4. Bare box (Req 5.1)',
      '',
    ].join('\n'),
  );
  try {
    const { tasks } = readLock(cwd).specs.demo;
    assert.equal(tasks['1'].text, '1. **Scaffold** (Req 1.1, 1.2)');
    assert.equal(tasks['9'].text, '9. A sub-bullet checkbox is a task line too (Req 9.9)');
    assert.equal(tasks['8b'].text, '8b. **Hardening**   (Req 4.11)', 'surrounding whitespace is trimmed, inner kept');
    assert.equal(tasks['4'].text, '4. Bare box (Req 5.1)');
    assert.deepEqual(tasks['1'].criteria, ['1.1', '1.2'], 'criteria are still recorded');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.8 the recorded text does not change when the task is ticked, so a tick can be compared with it', () => {
  const unticked = freezeWithTasks('- [ ] 1. One (Req 1.1)\n');
  const ticked = freezeWithTasks('- [x] 1. One (Req 1.1)\n');
  try {
    assert.equal(readLock(unticked).specs.demo.tasks['1'].text, readLock(ticked).specs.demo.tasks['1'].text);
  } finally {
    fs.rmSync(unticked, { recursive: true, force: true });
    fs.rmSync(ticked, { recursive: true, force: true });
  }
});

test('R2.8 a task with no criteria still has its text recorded', () => {
  const cwd = freezeWithTasks('- [ ] 1. Plain task\n');
  try {
    assert.deepEqual(readLock(cwd).specs.demo.tasks['1'], { criteria: [], text: '1. Plain task' });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
