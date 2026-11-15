// Contracts for Requirement 6.14 of the necro-core spec: `necro verify` says when later work under the same freeze
// replaced a receipt.
//
// R6.14  IF a receipt would otherwise print `MISMATCH` only because pinned files or contract results differ AND its
//        spec's requirement and contract hashes still equal the lock's AND a newer receipt for the same spec (by the
//        receipts' own write time) verifies as `CONFIRMED` or `INCOMPLETE` today THEN THE SYSTEM SHALL print
//        `SUPERSEDED`, name that newer receipt, say that later work under the same freeze changed the code or the
//        results, and, when the newer receipt is `INCOMPLETE`, also say that it could only be partly checked on this
//        machine and name what is missing, and exit with code 1. Any other difference stays `MISMATCH`.
//
// Each test builds a throwaway project in a temp directory. The spec `demo` has one contract that imports
// `src/value.js`, so every receipt pins that source file. The project is frozen once. Receipt 1 is written, the source
// file is changed (later work that keeps the contract passing), and receipt 2 is written. The tests then verify
// receipt 1. A short wait between receipts keeps their `createdAt` times apart. Two more cases: the receipts differ only
// in a contract result (a contract reads a file the receipt does not pin), and the newer receipt is INCOMPLETE because
// `pytest` or an imported package is missing on this machine (a fake `pytest` found through PATH, as in
// verify-incomplete.contract.test.js). This file carries its own helpers.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
//   from '../../src/receipts.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return { ...env, ...extra };
}

function necro(cwd, args, extraEnv) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv(extraEnv) });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-later-'));
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

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { value } from '../../src/value.js';
test('R6.14 value is positive', () => { assert.ok(value() > 0); });
`;

function setSource(cwd, n) {
  put(cwd, 'src/value.js', `export function value() { return ${n}; }\n`);
}

function check(cwd) {
  pause(40);
  const checked = necro(cwd, ['check', 'demo']);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}`);
  return { rel: found[1], receipt: JSON.parse(fs.readFileSync(path.join(cwd, found[1]), 'utf8')) };
}

// Freeze once, write receipt 1, change the source, write receipt 2.
function twoReceipts(cwd) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT);
  setSource(cwd, 1);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const first = check(cwd);
  setSource(cwd, 2);
  const second = check(cwd);
  assert.notEqual(first.receipt.receiptHash, second.receipt.receiptHash);
  return { first, second };
}

test('R6.14 verify prints SUPERSEDED naming the newer receipt and exits 1 when later work under the same freeze changed a pinned file', () =>
  temp((cwd) => {
    const { first, second } = twoReceipts(cwd);
    const newer = necro(cwd, ['verify', second.rel]);
    assert.equal(newer.status, 0, `the newer receipt is confirmed today: ${newer.stdout}${newer.stderr}`);

    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `exit code 1: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /SUPERSEDED/);
    assert.ok(
      res.stdout.includes(second.receipt.receiptHash) || res.stdout.includes(second.rel),
      `names the newer receipt: ${res.stdout}`,
    );
    assert.match(res.stdout, /later work/);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
  }));

test('R6.14 a receipt whose newer receipt does not verify today stays MISMATCH (the source changed again after the newer receipt)', () =>
  temp((cwd) => {
    const { first } = twoReceipts(cwd);
    setSource(cwd, 3);
    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /src\/value\.js/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a receipt with no newer receipt stays MISMATCH (only an older one confirms today)', () =>
  temp((cwd) => {
    const { first, second } = twoReceipts(cwd);
    // Back to the first source: the older receipt confirms again, the newer one no longer does.
    setSource(cwd, 1);
    const older = necro(cwd, ['verify', first.rel]);
    assert.equal(older.status, 0, `${older.stdout}${older.stderr}`);
    const res = necro(cwd, ['verify', second.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a receipt alone, changed after it was written, stays MISMATCH (no newer receipt exists)', () =>
  temp((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT);
    setSource(cwd, 1);
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const only = check(cwd);
    setSource(cwd, 2);
    const res = necro(cwd, ['verify', only.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a contract file that differs from the lock stays MISMATCH even though a newer receipt exists', () =>
  temp((cwd) => {
    const { first } = twoReceipts(cwd);
    put(cwd, 'contracts/demo/a.contract.test.js', `${CONTRACT}// edited after the freeze\n`);
    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /a\.contract\.test\.js/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a requirements file that differs from the lock stays MISMATCH even though a newer receipt exists', () =>
  temp((cwd) => {
    const { first } = twoReceipts(cwd);
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\nedited after the freeze\n');
    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /requirements\.md/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a receipt with an altered hash stays MISMATCH (altered), never SUPERSEDED', () =>
  temp((cwd) => {
    const { first } = twoReceipts(cwd);
    const file = path.join(cwd, first.rel);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.receiptHash = 'f'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /altered/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

test('R6.14 a newer receipt whose hash was tampered does not count as CONFIRMED, so the older receipt stays MISMATCH', () =>
  temp((cwd) => {
    const { first, second } = twoReceipts(cwd);
    const file = path.join(cwd, second.rel);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.receiptHash = 'e'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /SUPERSEDED/);
  }));

// -- A newer receipt that confirms although the older one differs only in a contract result --------------------------

const FLAG_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R6.14 flag is good', () => { assert.equal(fs.readFileSync('data/flag.txt', 'utf8').trim(), 'good'); });
`;

// `check` that may record a failing result (it still writes the receipt, Req 9.2).
function checkAny(cwd) {
  pause(40);
  const checked = necro(cwd, ['check', 'demo']);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}${checked.stderr}`);
  return { rel: found[1], receipt: JSON.parse(fs.readFileSync(path.join(cwd, found[1]), 'utf8')) };
}

test('R6.14 verify prints SUPERSEDED naming the newer receipt and exits 1 when the older receipt differs only because contract results differ and the newer receipt is CONFIRMED', () =>
  temp((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', FLAG_CONTRACT);
    put(cwd, 'data/flag.txt', 'bad\n');
    const frozen = necro(cwd, ['freeze', 'demo']);
    assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
    const first = checkAny(cwd);
    assert.equal(first.receipt.contracts[0].result, 'fail', 'the first receipt records a failing contract');
    put(cwd, 'data/flag.txt', 'good\n');
    const second = checkAny(cwd);
    assert.equal(second.receipt.contracts[0].result, 'pass');
    assert.deepEqual(
      first.receipt.contracts.map((c) => c.sha256),
      second.receipt.contracts.map((c) => c.sha256),
      'the contract files are the same under the same freeze',
    );
    assert.equal(first.receipt.requirements.sha256, second.receipt.requirements.sha256);

    const newer = necro(cwd, ['verify', second.rel]);
    assert.equal(newer.status, 0, `the newer receipt is confirmed today: ${newer.stdout}${newer.stderr}`);

    const res = necro(cwd, ['verify', first.rel]);
    assert.equal(res.status, 1, `exit code 1: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /SUPERSEDED/);
    assert.ok(
      res.stdout.includes(second.receipt.receiptHash) || res.stdout.includes(second.rel),
      `names the newer receipt: ${res.stdout}`,
    );
    assert.match(res.stdout, /later work/);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
    assert.doesNotMatch(res.stdout, /INCOMPLETE/);
  }));

// -- A newer receipt that is INCOMPLETE on this machine ------------------------------------------------------------------

const FAKE_PYTEST = `'use strict';
const fs = require('node:fs');
const [file, report] = process.argv.slice(2);
let cases = '';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  cases += '<testcase classname="fake" name="' + line.slice(space + 1) + '"/>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

// A temp project folder, a PATH with a working fake `pytest`, and a PATH without one.
function tempWithRunner(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-later-inc-'));
  try {
    const cwd = path.join(root, 'project');
    const withPytest = path.join(root, 'with-pytest');
    const without = path.join(root, 'empty');
    for (const d of [cwd, withPytest, without]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(withPytest, 'fake-pytest.cjs'), FAKE_PYTEST);
    const exe = path.join(withPytest, 'pytest');
    fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(withPytest, 'fake-pytest.cjs')}" "$@"\n`);
    fs.chmodSync(exe, 0o755);
    return fn(cwd, { WITH: { PATH: `${withPytest}:/usr/bin:/bin` }, WITHOUT: { PATH: without } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkWith(cwd, env) {
  pause(40);
  const checked = necro(cwd, ['check', 'demo'], env);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}`);
  return { rel: found[1], receipt: JSON.parse(fs.readFileSync(path.join(cwd, found[1]), 'utf8')) };
}

function assertSupersededIncomplete(res, second, missing) {
  assert.equal(res.status, 1, `exit code 1: ${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /SUPERSEDED/);
  assert.ok(
    res.stdout.includes(second.receipt.receiptHash) || res.stdout.includes(second.rel),
    `names the newer receipt: ${res.stdout}`,
  );
  assert.match(res.stdout, /later work/);
  assert.match(res.stdout, /partly checked/, `says the newer receipt was only partly checked here: ${res.stdout}`);
  assert.ok(res.stdout.includes(missing), `names what is missing (${missing}): ${res.stdout}`);
  assert.doesNotMatch(res.stdout, /MISMATCH/);
  assert.doesNotMatch(res.stdout, /CONFIRMED/);
}

test('R6.14 verify prints SUPERSEDED, says the newer receipt was only partly checked here and names "pytest not found", and exits 1 when the newer receipt is INCOMPLETE because pytest is missing', () =>
  tempWithRunner((cwd, env) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, '.kiro/specs/demo/runners.json', JSON.stringify({ 'test_*.py': 'pytest {file} {report}' }) + '\n');
    put(cwd, 'contracts/demo/a.contract.test.js', CONTRACT);
    put(cwd, 'contracts/demo/test_a.py', 'pass R6.14 python criterion holds\n');
    setSource(cwd, 1);
    const frozen = necro(cwd, ['freeze', 'demo'], env.WITH);
    assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
    const first = checkWith(cwd, env.WITH);
    setSource(cwd, 2);
    const second = checkWith(cwd, env.WITH);
    assert.notEqual(first.receipt.receiptHash, second.receipt.receiptHash);

    const newer = necro(cwd, ['verify', second.rel], env.WITHOUT);
    assert.equal(newer.status, 2, `the newer receipt is INCOMPLETE here: ${newer.stdout}${newer.stderr}`);
    assert.match(newer.stdout, /INCOMPLETE/);

    assertSupersededIncomplete(necro(cwd, ['verify', first.rel], env.WITHOUT), second, 'pytest not found');
  }));

test('R6.14 verify prints SUPERSEDED, says the newer receipt was only partly checked here and names the missing package, and exits 1 when the newer receipt is INCOMPLETE because an imported package is missing', () =>
  tempWithRunner((cwd) => {
    const PKG = 'necro-fake-dep';
    put(cwd, `node_modules/${PKG}/package.json`, JSON.stringify({ name: PKG, version: '1.0.0', type: 'module', main: 'index.js' }) + '\n');
    put(cwd, `node_modules/${PKG}/index.js`, 'export const dep = 1;\n');
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(
      cwd,
      'contracts/demo/a.contract.test.js',
      CONTRACT.replace("import { value }", `import { dep } from '${PKG}';\nimport { value }`).replace('value() > 0', 'value() > 0 && dep === 1'),
    );
    setSource(cwd, 1);
    const frozen = necro(cwd, ['freeze', 'demo']);
    assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
    const first = checkWith(cwd);
    setSource(cwd, 2);
    const second = checkWith(cwd);
    assert.notEqual(first.receipt.receiptHash, second.receipt.receiptHash);

    fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true, force: true });
    const newer = necro(cwd, ['verify', second.rel]);
    assert.equal(newer.status, 2, `the newer receipt is INCOMPLETE here: ${newer.stdout}${newer.stderr}`);
    assert.match(newer.stdout, /INCOMPLETE/);

    assertSupersededIncomplete(necro(cwd, ['verify', first.rel]), second, `${PKG} not found`);
  }));
