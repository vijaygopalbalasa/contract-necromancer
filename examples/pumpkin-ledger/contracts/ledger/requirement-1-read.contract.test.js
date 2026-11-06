// Frozen contract for Requirement 1: Read expenses.
// One test per acceptance criterion. Modules are imported inside each test so
// the test names register even while src/ and bin/ do not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/ledger.js', import.meta.url));

function runLedger(text) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-contract-'));
  try {
    const file = join(dir, 'party.txt');
    writeFileSync(file, text);
    const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, file], { encoding: 'utf8' });
    return { status, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('R1.1 records payer, whole-cent amount and what for each line', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/money.js'
  const { parseAmount } = await import('../../src/money.js');

  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('0.05'), 5);

  const { expenses } = parseLedger(
    [
      'Ann paid 12 for chips',
      'Bob paid 12.5 for soda and ice',
      'Cy paid 12.50 for pizza',
      'Ann paid 0.05 for gum',
    ].join('\n'),
  );
  assert.deepEqual(expenses, [
    { payerKey: 'ann', cents: 1200, what: 'chips', sharerKeys: null },
    { payerKey: 'bob', cents: 1250, what: 'soda and ice', sharerKeys: null },
    { payerKey: 'cy', cents: 1250, what: 'pizza', sharerKeys: null },
    { payerKey: 'ann', cents: 5, what: 'gum', sharerKeys: null },
  ]);
});

test('R1.2 shares a split line among the listed names and other lines among everyone', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  const parsed = parseLedger('Ann paid 30 for split bill split Ann,Bob\nBob paid 9 for tea');
  assert.deepEqual(parsed.expenses, [
    { payerKey: 'ann', cents: 3000, what: 'split bill', sharerKeys: ['ann', 'bob'] },
    { payerKey: 'bob', cents: 900, what: 'tea', sharerKeys: null },
  ]);

  // Cy is named only on the second line, yet shares that line's expense.
  const text = 'Ann paid 10.00 for cab split Ann,Bob\nCy paid 3.00 for gum';
  const rows = computeBalances(parseLedger(text));
  assert.deepEqual(rows, [
    { name: 'Ann', paid: 1000, share: 600, balance: 400 },
    { name: 'Bob', paid: 0, share: 600, balance: -600 },
    { name: 'Cy', paid: 300, share: 100, balance: 200 },
  ]);
});

test('R1.3 treats names that differ in case or spaces as one person with the first spelling', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  const text = [
    'Ann paid 10 for pizza',
    'ann paid 5 for soda',
    'Bob paid 3 for gum split  ANN , bob',
    'Cy paid 9 for tea split Cy, cy ,CY',
  ].join('\n');
  const parsed = parseLedger(text);

  assert.deepEqual(parsed.people, [
    { key: 'ann', name: 'Ann' },
    { key: 'bob', name: 'Bob' },
    { key: 'cy', name: 'Cy' },
  ]);
  assert.equal(parsed.expenses[1].payerKey, 'ann');
  assert.deepEqual(parsed.expenses[2].sharerKeys, ['ann', 'bob']);
  assert.deepEqual(parsed.expenses[3].sharerKeys, ['cy']);

  const names = computeBalances(parsed).map((row) => row.name);
  assert.deepEqual(names, ['Ann', 'Bob', 'Cy']);
});

test('R1.4 stops with the line number and one plain sentence for a bad line', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/errors.js'
  const { LedgerError } = await import('../../src/errors.js');

  const cases = [
    ['Ann paid 5 for tea\nbogus line', "Line 2: Write the line as '<payer> paid <amount> for <what>'."],
    ['# note\n\nAnn paid 0 for tea', 'Line 3: Amount must be more than zero.'],
    ['Ann paid 0.00 for tea', 'Line 1: Amount must be more than zero.'],
    ['Ann paid 5 for tea\nBob paid -3 for pie', 'Line 2: Amount must be more than zero.'],
    ['Ann paid 1.234 for tea', 'Line 1: Amount can have at most two decimals.'],
    ['Ann paid abc for tea', 'Line 1: Amount is not a number like 12 or 12.50.'],
    ['Ann paid 5 for tea split Ann,,Bob', 'Line 1: Split needs names separated by commas.'],
  ];
  for (const [text, message] of cases) {
    assert.throws(
      () => parseLedger(text),
      (err) => {
        assert.ok(err instanceof LedgerError, `LedgerError expected for ${JSON.stringify(text)}`);
        assert.equal(err.message, message);
        return true;
      },
    );
  }

  // The command line prints that sentence to stderr and exits 1.
  // runs '../../bin/ledger.js'
  const run = runLedger('Ann paid 5 for tea\nbogus line\n');
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr.trimEnd(), "Line 2: Write the line as '<payer> paid <amount> for <what>'.");
});

test('R1.5 skips empty lines and lines that start with #', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');

  const text = ['# party', '', '   ', 'Ann paid 5 for tea', '  # indented note', 'Bob paid 7 for pie', ''].join('\n');
  const parsed = parseLedger(text);
  assert.deepEqual(parsed.expenses, [
    { payerKey: 'ann', cents: 500, what: 'tea', sharerKeys: null },
    { payerKey: 'bob', cents: 700, what: 'pie', sharerKeys: null },
  ]);
  assert.deepEqual(parsed.people, [
    { key: 'ann', name: 'Ann' },
    { key: 'bob', name: 'Bob' },
  ]);

  assert.deepEqual(parseLedger(''), { people: [], expenses: [] });
  assert.deepEqual(parseLedger('# only a comment\n\n'), { people: [], expenses: [] });
});
