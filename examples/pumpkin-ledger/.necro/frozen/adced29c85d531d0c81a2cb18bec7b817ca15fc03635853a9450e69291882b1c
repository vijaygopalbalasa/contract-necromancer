// Frozen contract for Requirement 3: Settle up.
// Modules are imported inside each test so the test names register while src/ is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/ledger.js', import.meta.url));

// A balance row as computeBalances returns it, built from a name and a balance.
const row = (name, balance) => ({ name, paid: Math.max(balance, 0), share: Math.max(-balance, 0), balance });

// Fresh rows on every call, so a settle that mutates its input cannot affect a later call.
const rowsOf = (pairs) => pairs.map(([name, balance]) => row(name, balance));

test('R3.1 produces positive whole-cent payments that bring every balance to zero', async () => {
  // from '../../src/settle.js'
  const { settle } = await import('../../src/settle.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  const fixtures = [
    rowsOf([['Ann', 665], ['Bob', -133], ['Cy', -532]]),
    rowsOf([['Ann', 700], ['Bob', 300], ['Cy', -600], ['Dee', -400]]),
    computeBalances(parseLedger('Zed paid 100.00 for hall split Ann,Bob,Cy')),
  ];
  for (const balances of fixtures) {
    const remaining = new Map(balances.map((r) => [r.name, r.balance]));
    const payments = settle(balances.map((r) => ({ ...r })));
    assert.ok(payments.length > 0);
    for (const { from, to, amount } of payments) {
      assert.ok(Number.isSafeInteger(amount) && amount > 0, `amount ${amount} must be a positive integer`);
      remaining.set(from, remaining.get(from) + amount);
      remaining.set(to, remaining.get(to) - amount);
    }
    for (const [name, left] of remaining) assert.equal(left, 0, `${name} should end at zero`);
  }
});

test('R3.2 pays from the biggest debtor to the biggest creditor, ties by name, same every run', async () => {
  // from '../../src/settle.js'
  const { settle } = await import('../../src/settle.js');

  // Ann +7.00, Bob +3.00, Cy -6.00, Dee -4.00.
  const pairs = [['Ann', 700], ['Bob', 300], ['Cy', -600], ['Dee', -400]];
  const expected = [
    { from: 'Cy', to: 'Ann', amount: 600 },
    { from: 'Dee', to: 'Bob', amount: 300 },
    { from: 'Dee', to: 'Ann', amount: 100 },
  ];
  assert.deepEqual(settle(rowsOf(pairs)), expected);
  assert.deepEqual(settle(rowsOf(pairs)), expected);
  assert.deepEqual(settle(rowsOf([...pairs].reverse())), expected);

  // Creditor tie: ann and Bob are both owed 5.00. Names compare ignoring case, so ann goes first.
  const creditorTie = [['Bob', 500], ['ann', 500], ['Cy', -1000]];
  const creditorTieExpected = [
    { from: 'Cy', to: 'ann', amount: 500 },
    { from: 'Cy', to: 'Bob', amount: 500 },
  ];
  assert.deepEqual(settle(rowsOf(creditorTie)), creditorTieExpected);
  assert.deepEqual(settle(rowsOf([...creditorTie].reverse())), creditorTieExpected);

  // Debtor tie: dan and Zed both owe 3.00. dan goes first.
  const debtorTie = [['Zed', -300], ['dan', -300], ['Cy', 600]];
  const debtorTieExpected = [
    { from: 'dan', to: 'Cy', amount: 300 },
    { from: 'Zed', to: 'Cy', amount: 300 },
  ];
  assert.deepEqual(settle(rowsOf(debtorTie)), debtorTieExpected);
  assert.deepEqual(settle(rowsOf([...debtorTie].reverse())), debtorTieExpected);
});

test('R3.3 prints All square. and no payments when every balance is zero', async () => {
  // from '../../src/settle.js'
  const { settle } = await import('../../src/settle.js');
  // from '../../src/report.js'
  const { renderText } = await import('../../src/report.js');

  assert.deepEqual(settle([]), []);
  const zero = rowsOf([['Ann', 0], ['Bob', 0]]);
  assert.deepEqual(settle(zero), []);

  const lines = renderText(zero, []).split('\n').map((l) => l.trim());
  assert.ok(lines.includes('All square.'));
  assert.ok(!lines.some((l) => l.includes(' pays ')));

  // Through the command line: each person pays for exactly their own share.
  // runs '../../bin/ledger.js'
  const dir = mkdtempSync(join(tmpdir(), 'ledger-contract-'));
  try {
    const file = join(dir, 'party.txt');
    writeFileSync(file, 'Ann paid 5.00 for tea split Ann\nBob paid 2.50 for pie split Bob\n');
    const run = spawnSync(process.execPath, [BIN, file], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    const out = run.stdout.split('\n').map((l) => l.trim());
    assert.ok(out.includes('All square.'));
    assert.ok(!out.some((l) => l.includes(' pays ')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
