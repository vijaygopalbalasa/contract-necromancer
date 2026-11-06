import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger } from '../src/parse.js';
import { computeBalances } from '../src/balances.js';

test('computeBalances gives paid, share and balance per person', () => {
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
});

test('an expense without split is shared by everyone, including later names', () => {
  const text = 'Ann paid 10.00 for cab split Ann,Bob\nCy paid 3.00 for gum';
  const rows = computeBalances(parseLedger(text));
  assert.deepEqual(rows, [
    { name: 'Ann', paid: 1000, share: 600, balance: 400 },
    { name: 'Bob', paid: 0, share: 600, balance: -600 },
    { name: 'Cy', paid: 300, share: 100, balance: 200 },
  ]);
});

test('a payer outside the split list is credited in full and balances sum to zero', () => {
  const hall = computeBalances(parseLedger('Zed paid 100.00 for hall split Ann,Bob,Cy'));
  assert.deepEqual(hall, [
    { name: 'Zed', paid: 10000, share: 0, balance: 10000 },
    { name: 'Ann', paid: 0, share: 3334, balance: -3334 },
    { name: 'Bob', paid: 0, share: 3333, balance: -3333 },
    { name: 'Cy', paid: 0, share: 3333, balance: -3333 },
  ]);
  assert.equal(hall.reduce((s, r) => s + r.balance, 0), 0);
});
