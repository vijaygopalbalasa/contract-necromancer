// Contracts for Requirement 2 (freeze) of the necro-core spec.
//
// Each test builds a throwaway project in a temp directory and runs `necro freeze` in it.
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files that `necro freeze` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/lock.js'
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-lock-'));
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

function sha(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function lockOf(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
}

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
  return res;
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
// CRLF and a non-ASCII character, so a copy that goes through text would not be byte-identical.
const REQ = '# Requirements: demo\r\n\r\n1. WHEN a user acts THE SYSTEM SHALL answer \u00e9.\r\n';

const CONTRACT_A = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 first contract of a', () => { assert.ok(true); });
test('R1.2 second contract of a', () => { assert.ok(true); });
`;

const CONTRACT_B = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R2.1 only contract of b', () => { assert.ok(true); });
`;

test('R2.1 freeze records the SHA-256 of requirements.md and of every contract file in .necro/lock.json', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT_A);
    put(cwd, 'contracts/demo/b.contract.test.js', CONTRACT_B);
    // Not contract files: a different suffix, and a contract file of another spec.
    put(cwd, 'contracts/demo/README.md', '# notes\n');
    put(cwd, 'contracts/demo/helper.js', 'export const x = 1;\n');
    put(cwd, 'contracts/other/c.contract.test.js', CONTRACT_B);
    freeze(cwd);

    const entry = lockOf(cwd).specs.demo;
    assert.equal(entry.requirements.path, REQ_REL);
    assert.equal(entry.requirements.sha256, sha(REQ));
    const byPath = Object.fromEntries(entry.contracts.map((c) => [c.path, c.sha256]));
    assert.deepEqual(byPath, {
      'contracts/demo/a.contract.test.js': sha(CONTRACT_A),
      'contracts/demo/b.contract.test.js': sha(CONTRACT_B),
    });
    assert.equal(lockOf(cwd).specs.other, undefined, 'only the named spec is frozen');
  }));

test('R2.2 freeze stores a copy of each frozen file at .necro/frozen/<sha256>', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT_A);
    put(cwd, 'contracts/demo/b.contract.test.js', CONTRACT_B);
    freeze(cwd);

    for (const rel of [REQ_REL, 'contracts/demo/a.contract.test.js', 'contracts/demo/b.contract.test.js']) {
      const original = fs.readFileSync(path.join(cwd, rel));
      const copy = path.join(cwd, '.necro', 'frozen', sha(original));
      assert.ok(fs.existsSync(copy), `${rel} has a copy at .necro/frozen/${sha(original)}`);
      assert.ok(fs.readFileSync(copy).equals(original), `${rel}: the copy is byte for byte the same`);
    }
  }));

test('R2.3 freeze refuses when contracts/<spec>/ has no contract files and says at least one is needed', () => {
  // No contracts/demo directory at all, and a directory that holds only other files.
  for (const withOtherFiles of [false, true]) {
    temp((cwd) => {
      put(cwd, REQ_REL, REQ);
      if (withOtherFiles) {
        put(cwd, 'contracts/demo/README.md', '# not a contract\n');
        put(cwd, 'contracts/demo/helper.js', 'export const x = 1;\n');
      }
      const res = necro(cwd, ['freeze', 'demo']);
      assert.notEqual(res.status, 0, 'freeze refuses');
      assert.match(res.stderr, /No contracts found/);
      assert.match(res.stderr, /at least one/);
      assert.match(res.stderr, /contracts\/demo\//);
      const lockFile = path.join(cwd, '.necro', 'lock.json');
      assert.ok(!fs.existsSync(lockFile) || !lockOf(cwd).specs.demo, 'nothing is frozen');
    });
  }
});

test('R2.4 freezing again replaces that spec\'s entry and keeps other specs\' entries unchanged', () =>
  temp((cwd) => {
    put(cwd, '.kiro/specs/alpha/requirements.md', '# Alpha v1\n');
    put(cwd, 'contracts/alpha/a1.contract.test.js', CONTRACT_A);
    put(cwd, '.kiro/specs/beta/requirements.md', '# Beta v1\n');
    put(cwd, 'contracts/beta/b1.contract.test.js', CONTRACT_B);
    freeze(cwd, 'alpha');
    freeze(cwd, 'beta');
    const betaBefore = JSON.stringify(lockOf(cwd).specs.beta);
    const alphaBefore = JSON.stringify(lockOf(cwd).specs.alpha);

    // Change alpha: new requirements, one contract file removed and another added.
    put(cwd, '.kiro/specs/alpha/requirements.md', '# Alpha v2\n');
    fs.rmSync(path.join(cwd, 'contracts/alpha/a1.contract.test.js'));
    put(cwd, 'contracts/alpha/a2.contract.test.js', CONTRACT_B);
    freeze(cwd, 'alpha');

    const lock = lockOf(cwd);
    assert.deepEqual(Object.keys(lock.specs).sort(), ['alpha', 'beta']);
    assert.equal(JSON.stringify(lock.specs.beta), betaBefore, 'beta is unchanged');
    assert.notEqual(JSON.stringify(lock.specs.alpha), alphaBefore);
    assert.equal(lock.specs.alpha.requirements.sha256, sha('# Alpha v2\n'));
    assert.deepEqual(
      lock.specs.alpha.contracts.map((c) => c.path),
      ['contracts/alpha/a2.contract.test.js'],
      'the old entry is replaced, not merged',
    );
  }));

test('R2.5 freeze runs the contracts once and records the name of every contract in the lock', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    // Every test of this file leaves a line in runs.txt, so the number of runs can be counted.
    put(
      cwd,
      'contracts/demo/a.contract.test.js',
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R1.1 first marked contract', () => {
  fs.appendFileSync(new URL('../../runs.txt', import.meta.url), 'ran\\n');
  assert.ok(true);
});
test('R1.2 second marked contract', () => { assert.ok(true); });
test('R1.3 failing marked contract', () => { assert.equal(1, 2); });
`,
    );
    put(cwd, 'contracts/demo/b.contract.test.js', CONTRACT_B);
    freeze(cwd);

    const contracts = lockOf(cwd).specs.demo.contracts;
    const a = JSON.stringify(contracts.find((c) => c.path === 'contracts/demo/a.contract.test.js'));
    const b = JSON.stringify(contracts.find((c) => c.path === 'contracts/demo/b.contract.test.js'));
    for (const name of ['R1.1 first marked contract', 'R1.2 second marked contract', 'R1.3 failing marked contract']) {
      assert.ok(a.includes(JSON.stringify(name)), `${name} is recorded for a: ${a}`);
      assert.ok(!b.includes(JSON.stringify(name)), `${name} is not recorded for b`);
    }
    assert.ok(b.includes(JSON.stringify('R2.1 only contract of b')), `b records its own contract: ${b}`);
    assert.ok(!a.includes('R2.1 only contract of b'));

    const runs = fs.readFileSync(path.join(cwd, 'runs.txt'), 'utf8').split('\n').filter(Boolean);
    assert.equal(runs.length, 1, 'the contracts ran exactly once');
  }));

test('R2.6 freeze refuses a contract whose path resolves outside the project root', () => {
  // A contract file that is a link to a file elsewhere, and a contracts/<spec> directory that is a link elsewhere.
  for (const linkDirectory of [false, true]) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-outside-'));
    try {
      temp((cwd) => {
        put(cwd, REQ_REL, REQ);
        fs.writeFileSync(path.join(outside, 'evil.contract.test.js'), CONTRACT_A);
        if (linkDirectory) {
          fs.mkdirSync(path.join(cwd, 'contracts'), { recursive: true });
          fs.symlinkSync(outside, path.join(cwd, 'contracts', 'demo'), 'dir');
        } else {
          fs.mkdirSync(path.join(cwd, 'contracts', 'demo'), { recursive: true });
          fs.symlinkSync(path.join(outside, 'evil.contract.test.js'), path.join(cwd, 'contracts', 'demo', 'evil.contract.test.js'));
        }
        const res = necro(cwd, ['freeze', 'demo']);
        assert.notEqual(res.status, 0, 'freeze refuses');
        assert.match(res.stderr, /outside the project root/);
        const lockFile = path.join(cwd, '.necro', 'lock.json');
        assert.ok(!fs.existsSync(lockFile) || !lockOf(cwd).specs.demo, 'nothing is frozen');
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('R2.7 freeze records, for each task in tasks.md, the task id and the criteria its line names', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT_A);
    put(
      cwd,
      '.kiro/specs/demo/tasks.md',
      [
        '# Tasks',
        '',
        '- [x] 1. **Scaffold** (Req 1.1, 1.2, 1.3)',
        '  - Test first: a sub-bullet that names (Req 9.9) is not a task line.',
        '- [ ] 8b. **Hardening** (Req 4.11, 6.4)',
        '- [ ] 3. **Runner** (supports Req 4.4, 4.5, 6.1)',
        '- [ ] 12. Later task (Req 3.1, 1.2, 3.1)',
        '- [ ] 13. Other task (see 3.4 in the design)',
        '- [ ] 14. Plain task',
        '',
      ].join('\n'),
    );
    freeze(cwd);

    const { tasks } = lockOf(cwd).specs.demo;
    assert.deepEqual(Object.keys(tasks).sort(), ['1', '12', '13', '14', '3', '8b']);
    const criteria = (id) => [...tasks[id].criteria].sort();
    assert.deepEqual(criteria('1'), ['1.1', '1.2', '1.3']);
    assert.deepEqual(criteria('8b'), ['4.11', '6.4']);
    assert.deepEqual(criteria('3'), ['4.4', '4.5', '6.1']);
    assert.deepEqual(criteria('12'), ['1.2', '3.1'], 'each criterion once');
    assert.deepEqual(criteria('13'), [], 'a parenthesis without "Req" names no criteria');
    assert.deepEqual(criteria('14'), []);
  }));

test('R2.8 freeze records each task\'s full line text after the checkbox', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT_A);
    put(
      cwd,
      '.kiro/specs/demo/tasks.md',
      [
        '- [x] 1. **Scaffold** (Req 1.1, 1.2)',
        '- [ ] 8b. **Hardening**   (Req 4.11)  ',
        '* [ ] 4. Bare list marker (Req 5.1)',
        '- [ ] 5. Plain task',
        '',
      ].join('\n'),
    );
    freeze(cwd);

    const { tasks } = lockOf(cwd).specs.demo;
    assert.equal(tasks['1'].text, '1. **Scaffold** (Req 1.1, 1.2)', 'a ticked task keeps the same text as an unticked one');
    assert.equal(tasks['8b'].text, '8b. **Hardening**   (Req 4.11)', 'outer whitespace trimmed, inner kept');
    assert.equal(tasks['4'].text, '4. Bare list marker (Req 5.1)');
    assert.equal(tasks['5'].text, '5. Plain task');
  }));
