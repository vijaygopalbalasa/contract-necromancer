import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guard, ContractViolation } from '../src/runtime.js';
import * as splitModule from '../src/split.js';
import * as balancesModule from '../src/balances.js';
import * as settleModule from '../src/settle.js';
import { parseLedger } from '../src/parse.js';
import { splitPostconditions, balancesPostconditions, settlePostconditions } from '../contracts/ledger/postconditions.js';

// The runtime postconditions of the ledger (contracts/ledger/postconditions.js), checked on their own and on the real code.

const { check: checkSplit } = splitPostconditions.splitExpense;
const { check: checkBalances } = balancesPostconditions.computeBalances;
const { check: checkSettle } = settlePostconditions.settle;

test('each postcondition is tied to a criterion of requirements.md', () => {
  assert.equal(splitPostconditions.splitExpense.criterion, 'R5.1');
  assert.equal(balancesPostconditions.computeBalances.criterion, 'R2.2');
  assert.equal(settlePostconditions.settle.criterion, 'R3.1');
});

test('R5.1 splitExpense: shares that sum to the amount and differ by at most one cent pass', () => {
  assert.equal(checkSplit([100, ['a', 'b', 'c']], new Map([['a', 34], ['b', 33], ['c', 33]])), true);
  assert.equal(checkSplit([100, ['a', 'b']], new Map([['a', 50], ['b', 50]])), true);
  assert.equal(checkSplit([0, ['a', 'b']], new Map([['a', 0], ['b', 0]])), true);
  assert.equal(checkSplit([5, []], new Map()), true);
});

test('R5.1 splitExpense: lost cents, a spread above one cent, and a result that is not shares each fail with a reason', () => {
  assert.match(checkSplit([100, ['a', 'b', 'c']], new Map([['a', 33], ['b', 33], ['c', 33]])), /add up to 99/);
  assert.match(checkSplit([100, ['a', 'b']], new Map([['a', 51], ['b', 49]])), /differ by 2/);
  assert.match(checkSplit([100, ['a']], new Map([['a', 100.5]])), /whole number/);
  assert.match(checkSplit([100, ['a']], { a: 100 }), /Map/);
  assert.match(checkSplit([5, []], new Map([['a', 5]])), /no sharers/);
});

test('R2.2 computeBalances: balances that sum to zero pass, others fail with the sum', () => {
  assert.equal(checkBalances([], [{ balance: 5 }, { balance: -5 }]), true);
  assert.equal(checkBalances([], []), true);
  assert.match(checkBalances([], [{ balance: 5 }, { balance: -4 }]), /add up to 1 cents/);
  assert.match(checkBalances([], 'x'), /list/);
});

test('R3.1 settle: payments that bring every balance to zero pass, others fail naming what is wrong', () => {
  const rows = [{ name: 'Ann', balance: 667 }, { name: 'Bob', balance: -333 }, { name: 'Cy', balance: -334 }];
  const good = [{ from: 'Bob', to: 'Ann', amount: 333 }, { from: 'Cy', to: 'Ann', amount: 334 }];
  assert.equal(checkSettle([rows], good), true);
  assert.equal(checkSettle([[{ name: 'Ann', balance: 0 }]], []), true);
  assert.match(checkSettle([rows], good.slice(0, 1)), /unsettled: Ann 334, Cy -334/);
  assert.match(checkSettle([rows], [{ from: 'Bob', to: 'Ann', amount: 0 }]), /positive whole number/);
  assert.match(checkSettle([rows], [{ from: 'Bob', to: 'Ann', amount: 1.5 }]), /positive whole number/);
  assert.match(checkSettle([rows], [{ from: 'Bob', to: 'Zed', amount: 5 }]), /no balance/);
});

test('the real splitExpense, computeBalances and settle pass their postconditions on the sample party', () => {
  const { splitExpense } = guard(splitModule, splitPostconditions);
  const { computeBalances } = guard(balancesModule, balancesPostconditions);
  const { settle } = guard(settleModule, settlePostconditions);
  const parsed = parseLedger(readFileSync(new URL('../party.txt', import.meta.url), 'utf8'));
  const everyone = parsed.people.map((p) => p.key);
  for (const e of parsed.expenses) splitExpense(e.cents, e.sharerKeys ?? everyone);
  const rows = computeBalances(parsed);
  assert.ok(settle(rows).length > 0);
});

test('a splitExpense that loses a cent throws a ContractViolation naming R5.1 when it is called through the guard', () => {
  const lossy = { splitExpense: (cents, keys) => new Map(keys.map((k) => [k, Math.floor(cents / keys.length)])) };
  const { splitExpense } = guard(lossy, splitPostconditions);
  assert.throws(
    () => splitExpense(100, ['a', 'b', 'c']),
    (e) => e instanceof ContractViolation && e.criterion === 'R5.1' && /R5\.1 splitExpense/.test(e.message) && /99/.test(e.message),
  );
  assert.equal(splitExpense(99, ['a', 'b', 'c']).get('a'), 33);
});
