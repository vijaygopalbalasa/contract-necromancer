import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../src/canon.js';
import { freezeSpec } from '../src/lock.js';

const BIN = path.join(import.meta.dirname, '../bin/necro.js');

const PASSING = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.1 holds', () => {
  assert.ok(true);
});
`;

const FAILING = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.2 is broken', () => {
  assert.equal(1, 2);
});
`;

const TASKS = `# Tasks

- [ ] 1. **First** (Req 1.1)
- [ ] 2. **Second** (Req 1.2)
`;

function project(contracts, tasks = TASKS) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-check-'));
  const spec = path.join(cwd, '.kiro/specs/demo');
  fs.mkdirSync(spec, { recursive: true });
  fs.writeFileSync(path.join(spec, 'requirements.md'), '# Requirements\n');
  fs.writeFileSync(path.join(spec, 'tasks.md'), tasks);
  fs.mkdirSync(path.join(cwd, 'contracts/demo'), { recursive: true });
  for (const [name, text] of Object.entries(contracts)) {
    fs.writeFileSync(path.join(cwd, 'contracts/demo', name), text);
  }
  return cwd;
}

function necro(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function receiptsIn(cwd) {
  const dir = path.join(cwd, '.necro/receipts/demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

test('R9.1 and R9.2 check on a passing frozen spec prints each result, writes a task-less receipt, exits 0', () => {
  const cwd = project({ 'a.contract.test.js': PASSING });
  try {
    freezeSpec(cwd, 'demo');
    const res = necro(cwd, 'check', 'demo');
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /pass.*R1\.1 holds/);
    const files = receiptsIn(cwd);
    assert.equal(files.length, 1);
    assert.ok(res.stdout.includes(`.necro/receipts/demo/${files[0]}`), 'prints the receipt path');
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, '.necro/receipts/demo', files[0]), 'utf8'));
    assert.equal(receipt.task, null);
    assert.deepEqual(receipt.required, ['R1.1 holds']);
    assert.deepEqual(
      receipt.contracts.map((c) => [c.name, c.result]),
      [['R1.1 holds', 'pass']],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R9.2 check with a failing contract exits 1, names it, and still writes the receipt', () => {
  const cwd = project({ 'a.contract.test.js': PASSING, 'b.contract.test.js': FAILING });
  try {
    freezeSpec(cwd, 'demo');
    const res = necro(cwd, 'check', 'demo');
    assert.equal(res.status, 1, res.stderr + res.stdout);
    assert.match(res.stdout, /fail.*R1\.2 is broken/);
    assert.match(res.stdout, /pass.*R1\.1 holds/);
    const files = receiptsIn(cwd);
    assert.equal(files.length, 1, 'a receipt is written even though a contract fails');
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, '.necro/receipts/demo', files[0]), 'utf8'));
    assert.equal(receipt.task, null);
    assert.deepEqual(receipt.required, ['R1.1 holds', 'R1.2 is broken']);
    assert.deepEqual(
      receipt.contracts.map((c) => [c.name, c.result]).sort(),
      [
        ['R1.1 holds', 'pass'],
        ['R1.2 is broken', 'fail'],
      ],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R9.3 check on a spec that is not frozen exits 1 and says to freeze it first', () => {
  const cwd = project({ 'a.contract.test.js': PASSING });
  try {
    const res = necro(cwd, 'check', 'demo');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not frozen/);
    assert.match(res.stderr, /necro freeze demo/);
    assert.deepEqual(receiptsIn(cwd), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R9.3 check on a spec name that only exists as an Object property is not frozen', () => {
  const cwd = project({ 'a.contract.test.js': PASSING });
  try {
    freezeSpec(cwd, 'demo');
    const res = necro(cwd, 'check', 'constructor');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not frozen/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R9.4 check leaves tasks.md unchanged, passing or failing', () => {
  for (const contracts of [{ 'a.contract.test.js': PASSING }, { 'b.contract.test.js': FAILING }]) {
    const cwd = project(contracts);
    try {
      freezeSpec(cwd, 'demo');
      const tasks = path.join(cwd, '.kiro/specs/demo/tasks.md');
      const before = sha256(fs.readFileSync(tasks));
      necro(cwd, 'check', 'demo');
      assert.equal(sha256(fs.readFileSync(tasks)), before);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('R9.1 check without a spec name prints usage and exits 1', () => {
  const cwd = project({ 'a.contract.test.js': PASSING });
  try {
    const res = necro(cwd, 'check');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage: necro check <spec>/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R9.1 a receipt from check passes necro verify', () => {
  const cwd = project({ 'a.contract.test.js': PASSING });
  try {
    freezeSpec(cwd, 'demo');
    assert.equal(necro(cwd, 'check', 'demo').status, 0);
    const file = receiptsIn(cwd)[0];
    const res = necro(cwd, 'verify', `.necro/receipts/demo/${file}`);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /CONFIRMED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
