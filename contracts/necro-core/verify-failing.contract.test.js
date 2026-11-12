// Contracts for Requirements 6.11 and 6.12 of the necro-core spec: `necro verify` says when a confirmed receipt
// records failing contracts.
//
// R6.11  WHEN `necro verify` prints CONFIRMED for a receipt that records one or more failing contracts, THE SYSTEM
//        SHALL also print, on the next line, `This receipt records N failing contracts: <names>.` (`1 failing
//        contract` for one), naming each failing contract in the receipt's order, and SHALL still exit with code 0,
//        because the receipt is true.
// R6.12  WHEN `necro verify` prints CONFIRMED for a receipt whose recorded contracts all pass, THE SYSTEM SHALL print
//        no such line, so the output for a passing receipt stays as it is.
//
// Each test builds a throwaway project in a temp directory (the approach of verify.contract.test.js), freezes it and
// makes the receipt with `necro check`, which writes a receipt even when a contract fails. It then runs `necro verify`
// from the project root, so the first line is the verdict and the second line is the one under test. This file carries
// its own helpers. Names in the failing line are joined with ", ", as the other verify messages join paths and names.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
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

function necro(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-failing-'));
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

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

// Freeze a spec called `demo` with one contract file and make its receipt with `necro check`.
// Returns the receipt's project-relative path and content, and the exit code of check.
function receiptFor(cwd, contractSource) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, 'contracts/demo/a.contract.test.js', `${HEAD}${contractSource}`);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo']);
  const found = /Receipt: (\S+)/.exec(checked.stdout);
  assert.ok(found, `check wrote a receipt: ${checked.stdout}${checked.stderr}`);
  const rel = found[1];
  return { rel, receipt: JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8')), checkStatus: checked.status };
}

// The names of the receipt's failing contracts, in the receipt's order.
function failingInOrder(receipt) {
  return receipt.contracts.filter((c) => c.result !== 'pass').map((c) => c.name);
}

test('R6.11 verify prints, on the line after CONFIRMED, how many failing contracts the receipt records and names them, and still exits 0 (one failing contract)', () =>
  temp((cwd) => {
    const { rel, receipt, checkStatus } = receiptFor(
      cwd,
      `test('R6.11 holds', () => { assert.ok(true); });
test('R6.11 broken on purpose', () => { assert.equal(1, 2); });
`,
    );
    assert.equal(checkStatus, 1, 'check exits 1 when a contract fails');
    const failing = failingInOrder(receipt);
    assert.deepEqual(failing, ['R6.11 broken on purpose'], 'the receipt records the one failing contract');

    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 0, `a true receipt is confirmed even when it records a failure: ${res.stdout}${res.stderr}`);
    const lines = res.stdout.split('\n');
    assert.equal(lines[0], `CONFIRMED ${receipt.receiptHash}.`);
    assert.equal(lines[1], 'This receipt records 1 failing contract: R6.11 broken on purpose.');
    assert.doesNotMatch(res.stdout, /MISMATCH/);
  }));

test('R6.11 verify names every failing contract in the receipt\'s order and uses the plural for two (two failing contracts)', () =>
  temp((cwd) => {
    // The failing names are not in alphabetical order, so a sorted list would differ from the receipt's order.
    const { rel, receipt, checkStatus } = receiptFor(
      cwd,
      `test('R6.11 zebra broken on purpose', () => { assert.equal(1, 2); });
test('R6.11 holds', () => { assert.ok(true); });
test('R6.11 apple broken on purpose', () => { assert.equal('a', 'b'); });
`,
    );
    assert.equal(checkStatus, 1, 'check exits 1 when a contract fails');
    const failing = failingInOrder(receipt);
    assert.equal(failing.length, 2, 'the receipt records two failing contracts');
    assert.notDeepEqual(failing, [...failing].sort(), 'the receipt\'s order is not alphabetical, so the order is tested');

    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const lines = res.stdout.split('\n');
    assert.equal(lines[0], `CONFIRMED ${receipt.receiptHash}.`);
    assert.equal(lines[1], `This receipt records 2 failing contracts: ${failing.join(', ')}.`);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
  }));

test('R6.12 verify prints CONFIRMED and the receipt hash and no failing-contract line for a receipt whose recorded contracts all pass', () =>
  temp((cwd) => {
    const { rel, receipt, checkStatus } = receiptFor(
      cwd,
      `test('R6.12 first holds', () => { assert.ok(true); });
test('R6.12 second holds', () => { assert.equal(1 + 1, 2); });
`,
    );
    assert.equal(checkStatus, 0, 'check exits 0 when every contract passes');
    assert.deepEqual(failingInOrder(receipt), [], 'the receipt records no failing contract');

    const res = necro(cwd, ['verify', rel]);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /CONFIRMED/);
    assert.ok(res.stdout.includes(receipt.receiptHash), `prints the receipt hash: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /failing contract/i);
    assert.equal(res.stdout, `CONFIRMED ${receipt.receiptHash}.\n`, 'the output for a passing receipt is the one line it always was');
  }));
