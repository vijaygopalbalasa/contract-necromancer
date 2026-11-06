// Frozen contract for Requirement 2: Split to the cent.
// Modules are imported inside each test so the test names register while src/ is empty.
import test from 'node:test';
import assert from 'node:assert/strict';

test('R2.1 gives each sharer the floor and the extra cents to the first names alphabetically', async () => {
  // from '../../src/split.js'
  const { splitExpense } = await import('../../src/split.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  const shares = (cents, keys) => Object.fromEntries(splitExpense(cents, keys));

  // 10.00 over three people: 3.34, 3.33, 3.33.
  assert.deepEqual(shares(1000, ['cy', 'ann', 'bob']), { ann: 334, bob: 333, cy: 333 });
  // 1 cent over seven people goes to the first name only.
  assert.deepEqual(shares(1, ['g', 'f', 'e', 'd', 'c', 'b', 'a']), { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0 });
  // 10.00 over six people: four people get 1.67 and two get 1.66.
  assert.deepEqual(shares(1000, ['f', 'e', 'd', 'c', 'b', 'a']), { a: 167, b: 167, c: 167, d: 167, e: 166, f: 166 });
  // Exact division gives equal shares.
  assert.deepEqual(shares(1000, ['bob', 'ann']), { ann: 500, bob: 500 });

  // Alphabetical order ignores letter case: ann comes before Bob.
  const { people, expenses } = parseLedger('Zed paid 10.00 for pizza split Zed,ann,Bob');
  assert.deepEqual(computeBalances({ people, expenses }), [
    { name: 'Zed', paid: 1000, share: 333, balance: 667 },
    { name: 'ann', paid: 0, share: 334, balance: -334 },
    { name: 'Bob', paid: 0, share: 333, balance: -333 },
  ]);
});

test('R2.2 makes balances paid minus shares and sums them to exactly zero', async () => {
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  const party = [
    'Ann paid 10.00 for pizza',
    'Bob paid 4.01 for drinks split Bob,Cy',
    'Cy paid 0.01 for mint split Ann',
  ].join('\n');
  const rows = computeBalances(parseLedger(party));
  assert.deepEqual(rows, [
    { name: 'Ann', paid: 1000, share: 335, balance: 665 },
    { name: 'Bob', paid: 401, share: 534, balance: -133 },
    { name: 'Cy', paid: 1, share: 533, balance: -532 },
  ]);

  // A payer who is not among the sharers is credited in full.
  const hall = computeBalances(parseLedger('Zed paid 100.00 for hall split Ann,Bob,Cy'));
  assert.deepEqual(hall, [
    { name: 'Zed', paid: 10000, share: 0, balance: 10000 },
    { name: 'Ann', paid: 0, share: 3334, balance: -3334 },
    { name: 'Bob', paid: 0, share: 3333, balance: -3333 },
    { name: 'Cy', paid: 0, share: 3333, balance: -3333 },
  ]);

  for (const result of [rows, hall]) {
    for (const row of result) assert.equal(row.balance, row.paid - row.share);
    assert.equal(result.reduce((sum, row) => sum + row.balance, 0), 0);
  }
});
