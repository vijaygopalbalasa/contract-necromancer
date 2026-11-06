// Contracts for Requirement 9 (check on demand): `necro check <spec>`.
// R9.1 to R9.4.
//
// Each test builds a throwaway project in a temp directory, freezes it and runs `necro check`. This file carries its
// own helpers.
//
// The receipt pins the files `necro check` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/check.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-check-'));
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

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

function receiptFiles(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const TASKS_REL = '.kiro/specs/demo/tasks.md';
const TASKS = '# Tasks\n\n- [ ] 1. **First** (Req 1.1)\n- [x] 2. **Second** (Req 1.2)\n';

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;
const PASSING_A = `${HEAD}test('R1.1 holds', () => { assert.ok(true); });
test('R1.3 also holds', () => { assert.ok(true); });
`;
const PASSING_B = `${HEAD}test('R2.1 holds in another file', () => { assert.ok(true); });\n`;
const FAILING_C = `${HEAD}test('R1.2 is broken', () => { assert.equal(1, 2); });\n`;

function project(cwd, contracts) {
  put(cwd, REQ_REL, '# Requirements: demo\n');
  put(cwd, TASKS_REL, TASKS);
  for (const [file, source] of Object.entries(contracts)) put(cwd, `contracts/demo/${file}`, source);
  freeze(cwd);
}

test('R9.1 check on a frozen spec runs every frozen contract, prints each result by name, and writes a receipt with task null and every contract required', () =>
  temp((cwd) => {
    project(cwd, { 'a.contract.test.js': PASSING_A, 'b.contract.test.js': PASSING_B, 'c.contract.test.js': FAILING_C });
    const res = necro(cwd, ['check', 'demo']);

    // Every contract of every file, each with its result.
    for (const [result, name] of [
      ['pass', 'R1.1 holds'],
      ['pass', 'R1.3 also holds'],
      ['pass', 'R2.1 holds in another file'],
      ['fail', 'R1.2 is broken'],
    ]) {
      assert.match(res.stdout, new RegExp(`^${result} ${name.replace(/\./g, '\\.')}$`, 'm'), `${result} ${name} in: ${res.stdout}`);
    }

    const files = receiptFiles(cwd);
    assert.equal(files.length, 1);
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, '.necro/receipts/demo', files[0]), 'utf8'));
    assert.equal(receipt.task, null);
    assert.deepEqual(receipt.required, ['R1.1 holds', 'R1.2 is broken', 'R1.3 also holds', 'R2.1 holds in another file']);
    assert.deepEqual(
      Object.fromEntries(receipt.contracts.map((c) => [c.name, c.result])),
      { 'R1.1 holds': 'pass', 'R1.3 also holds': 'pass', 'R2.1 holds in another file': 'pass', 'R1.2 is broken': 'fail' },
    );
  }));

test('R9.2 check exits 0 and prints the receipt path when every contract passes, and exits 1 and still writes the receipt when any fails', () => {
  temp((cwd) => {
    project(cwd, { 'a.contract.test.js': PASSING_A });
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const [file] = receiptFiles(cwd);
    assert.ok(res.stdout.includes(`.necro/receipts/demo/${file}`), `prints the receipt path: ${res.stdout}`);
    assert.ok(fs.existsSync(path.join(cwd, '.necro/receipts/demo', file)));
  });

  temp((cwd) => {
    project(cwd, { 'a.contract.test.js': PASSING_A, 'c.contract.test.js': FAILING_C });
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /^fail R1\.2 is broken$/m);
    const files = receiptFiles(cwd);
    assert.equal(files.length, 1, 'the receipt is written although a contract fails');
    assert.ok(res.stdout.includes(`.necro/receipts/demo/${files[0]}`), `still prints the receipt path: ${res.stdout}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, '.necro/receipts/demo', files[0]), 'utf8'));
    assert.equal(receipt.contracts.find((c) => c.name === 'R1.2 is broken').result, 'fail');
  });
});

test('R9.3 check on a spec that is not frozen exits 1 and says to freeze it first', () => {
  // The spec has files but was never frozen.
  temp((cwd) => {
    put(cwd, REQ_REL, '# Requirements: demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', PASSING_A);
    const res = necro(cwd, ['check', 'demo']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not frozen/);
    assert.match(res.stderr, /necro freeze demo/);
    assert.deepEqual(receiptFiles(cwd), []);
  });

  // Another spec is frozen, and a name that only exists as an Object property is not a spec.
  temp((cwd) => {
    project(cwd, { 'a.contract.test.js': PASSING_A });
    for (const spec of ['other', 'constructor', '__proto__']) {
      const res = necro(cwd, ['check', spec]);
      assert.equal(res.status, 1, spec);
      assert.match(res.stderr, /not frozen/, spec);
    }
  });
});

test('R9.4 check does not change tasks.md', () => {
  for (const contracts of [{ 'a.contract.test.js': PASSING_A }, { 'c.contract.test.js': FAILING_C }]) {
    temp((cwd) => {
      project(cwd, contracts);
      const before = sha(fs.readFileSync(path.join(cwd, TASKS_REL)));
      necro(cwd, ['check', 'demo']);
      assert.equal(sha(fs.readFileSync(path.join(cwd, TASKS_REL))), before);
      assert.equal(fs.readFileSync(path.join(cwd, TASKS_REL), 'utf8'), TASKS);
    });
  }
});
