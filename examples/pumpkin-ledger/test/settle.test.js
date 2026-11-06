import test from 'node:test';
import assert from 'node:assert/strict';
import { settle } from '../src/settle.js';

const row = (name, balance) => ({ name, paid: Math.max(balance, 0), share: Math.max(-balance, 0), balance });
const rowsOf = (pairs) => pairs.map(([name, balance]) => row(name, balance));

test('settle pays biggest debtor to biggest creditor, deterministically', () => {
  const pairs = [['Ann', 700], ['Bob', 300], ['Cy', -600], ['Dee', -400]];
  const expected = [
    { from: 'Cy', to: 'Ann', amount: 600 },
    { from: 'Dee', to: 'Bob', amount: 300 },
    { from: 'Dee', to: 'Ann', amount: 100 },
  ];
  assert.deepEqual(settle(rowsOf(pairs)), expected);
  assert.deepEqual(settle(rowsOf([...pairs].reverse())), expected);
});

test('settle breaks ties by name ignoring case', () => {
  const creditorTie = [['Bob', 500], ['ann', 500], ['Cy', -1000]];
  assert.deepEqual(settle(rowsOf(creditorTie)), [
    { from: 'Cy', to: 'ann', amount: 500 },
    { from: 'Cy', to: 'Bob', amount: 500 },
  ]);
  const debtorTie = [['Zed', -300], ['dan', -300], ['Cy', 600]];
  assert.deepEqual(settle(rowsOf(debtorTie)), [
    { from: 'dan', to: 'Cy', amount: 300 },
    { from: 'Zed', to: 'Cy', amount: 300 },
  ]);
});

test('settle payments are positive integers that zero every balance', () => {
  const fixtures = [
    rowsOf([['Ann', 665], ['Bob', -133], ['Cy', -532]]),
    rowsOf([['Ann', 700], ['Bob', 300], ['Cy', -600], ['Dee', -400]]),
  ];
  for (const balances of fixtures) {
    const remaining = new Map(balances.map((r) => [r.name, r.balance]));
    const payments = settle(balances.map((r) => ({ ...r })));
    for (const { from, to, amount } of payments) {
      assert.ok(Number.isSafeInteger(amount) && amount > 0);
      remaining.set(from, remaining.get(from) + amount);
      remaining.set(to, remaining.get(to) - amount);
    }
    for (const left of remaining.values()) assert.equal(left, 0);
  }
});

test('settle returns [] when all balances are zero', () => {
  assert.deepEqual(settle([]), []);
  assert.deepEqual(settle(rowsOf([['Ann', 0], ['Bob', 0]])), []);
});
