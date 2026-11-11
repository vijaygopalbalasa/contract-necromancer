// Frozen contract for Requirement 4: Command line.
// Modules are imported inside each test so the test names register while src/ and bin/ are empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/ledger.js', import.meta.url));

// 10.00 shared by Ann, Bob and Cy: shares 3.34, 3.33, 3.33. Bob and Cy tie as debtors, Bob goes first.
const PARTY = 'Ann paid 10.00 for pizza split Ann,Bob,Cy\n';

const BALANCES = [
  { name: 'Ann', paid: 1000, share: 334, balance: 666 },
  { name: 'Bob', paid: 0, share: 333, balance: -333 },
  { name: 'Cy', paid: 0, share: 333, balance: -333 },
];
const PAYMENTS = [
  { from: 'Bob', to: 'Ann', amount: 333 },
  { from: 'Cy', to: 'Ann', amount: 333 },
];

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-contract-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(args) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { status, stdout, stderr };
}

// Checks the table and payment lines without fixing column padding or rule lines.
function assertReport(output) {
  const tokens = (line) => line.trim().split(/\s+/);
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  const find = (want) => lines.findIndex((l) => JSON.stringify(tokens(l)) === JSON.stringify(want));

  const header = find(['Name', 'Paid', 'Share', 'Balance']);
  const ann = find(['Ann', '10.00', '3.34', '6.66']);
  const bob = find(['Bob', '0.00', '3.33', '-3.33']);
  const cy = find(['Cy', '0.00', '3.33', '-3.33']);
  assert.ok(header >= 0, 'header line Name Paid Share Balance');
  assert.ok(header < ann && ann < bob && bob < cy, 'rows follow the header in order of first appearance');

  const paymentLines = lines.filter((l) => l.includes(' pays ')).map((l) => l.trim());
  assert.deepEqual(paymentLines, ['Bob pays Ann 3.33', 'Cy pays Ann 3.33']);
  assert.ok(lines.findIndex((l) => l.trim() === paymentLines[0]) > cy, 'payments come after the table');
  assert.ok(!lines.some((l) => l.trim() === 'All square.'));
}

test('R4.1 prints the balances table then one pays line per payment with two decimals', async () => {
  // from '../../src/report.js'
  const { renderText } = await import('../../src/report.js');
  // from '../../src/money.js'
  const { formatCents } = await import('../../src/money.js');

  assert.equal(formatCents(1250), '12.50');
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatCents(-505), '-5.05');

  assertReport(renderText(BALANCES, PAYMENTS));

  // runs '../../bin/ledger.js'
  withDir((dir) => {
    const file = join(dir, 'party.txt');
    writeFileSync(file, PARTY);
    const result = run([file]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assertReport(result.stdout);
  });
});

test('R4.2 prints balances and payments as JSON with amounts in integer cents', async () => {
  // from '../../src/report.js'
  const { renderJson } = await import('../../src/report.js');

  const direct = JSON.parse(renderJson(BALANCES, PAYMENTS));
  assert.deepEqual(direct, { balances: BALANCES, payments: PAYMENTS });
  assert.deepEqual(Object.keys(direct), ['balances', 'payments']);

  const square = JSON.parse(renderJson([{ name: 'Ann', paid: 0, share: 0, balance: 0 }], []));
  assert.deepEqual(square, { balances: [{ name: 'Ann', paid: 0, share: 0, balance: 0 }], payments: [] });

  // runs '../../bin/ledger.js'
  withDir((dir) => {
    const file = join(dir, 'party.txt');
    writeFileSync(file, PARTY);
    const result = run([file, '--json']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const printed = JSON.parse(result.stdout);
    assert.deepEqual(printed, { balances: BALANCES, payments: PAYMENTS });
    assert.deepEqual(Object.keys(printed), ['balances', 'payments']);
  });
});

test('R4.3 exits 1 with one plain sentence when the file is missing or unreadable', async () => {
  // runs '../../bin/ledger.js'
  withDir((dir) => {
    const missing = join(dir, 'missing.txt');
    const result = run([missing]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trimEnd(), `Cannot read ${missing}.`);

    // A directory cannot be read as a file either.
    const asDirectory = run([dir]);
    assert.equal(asDirectory.status, 1);
    assert.equal(asDirectory.stdout, '');
    assert.equal(asDirectory.stderr.trimEnd(), `Cannot read ${dir}.`);
  });
});
