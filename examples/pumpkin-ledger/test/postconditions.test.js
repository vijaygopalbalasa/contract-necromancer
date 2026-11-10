import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guard, ContractViolation } from '../src/runtime.js';
import * as splitModule from '../src/split.js';
import * as balancesModule from '../src/balances.js';
import * as settleModule from '../src/settle.js';
import { parseLedger } from '../src/parse.js';
import { splitPostconditions, balancesPostconditions, settlePostconditions, reportPostconditions } from '../contracts/ledger/postconditions.js';
import { renderText, renderJson } from '../src/report.js';

// The runtime postconditions of the ledger (contracts/ledger/postconditions.js), checked on their own and on the real code.

const { check: checkSplit } = splitPostconditions.splitExpense;
const { check: checkSettle } = settlePostconditions.settle;

// An entry of the table is a { criterion, check } or a list of them. checkAll runs the list the way guard() does and returns
// the first failure as { criterion, reason }, or true when every check passes.
const listOf = (entry) => (Array.isArray(entry) ? entry : [entry]);
function checkAll(entry, args, result) {
  for (const c of listOf(entry)) {
    const verdict = c.check(args, result);
    if (verdict !== true) return { criterion: c.criterion, reason: verdict };
  }
  return true;
}
const checkBalances = (args, rows) => checkAll(balancesPostconditions.computeBalances, args, rows);

test('each postcondition is tied to a criterion of requirements.md', () => {
  assert.equal(splitPostconditions.splitExpense.criterion, 'R5.1');
  assert.deepEqual(listOf(balancesPostconditions.computeBalances).map((c) => c.criterion), ['R2.2', 'R2.2', 'R2.1']);
  assert.deepEqual(listOf(reportPostconditions.renderText).map((c) => c.criterion), ['R4.1', 'R3.3']);
  assert.equal(reportPostconditions.renderJson.criterion, 'R4.2');
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
  assert.equal(checkBalances([{ people: [], expenses: [] }], []), true);
  assert.match(checkBalances([], [{ balance: 5 }, { balance: -4 }]).reason, /add up to 1 cents/);
  assert.equal(checkBalances([], [{ balance: 5 }, { balance: -4 }]).criterion, 'R2.2');
  assert.match(checkBalances([], 'x').reason, /list/);
});

// A party of three: Ann paid 30.00 shared by all, Bob paid 10.01 shared by Bob and Cy.
const parsedParty = {
  people: [{ key: 'ann', name: 'Ann' }, { key: 'bob', name: 'Bob' }, { key: 'cy', name: 'Cy' }],
  expenses: [
    { payerKey: 'ann', cents: 3000, sharerKeys: null },
    { payerKey: 'bob', cents: 1001, sharerKeys: ['bob', 'cy'] },
  ],
};
// Shares: 1000 each from the first, then 501 to bob (the first alphabetically) and 500 to cy.
const rightRows = [
  { name: 'Ann', paid: 3000, share: 1000, balance: 2000 },
  { name: 'Bob', paid: 1001, share: 1501, balance: -500 },
  { name: 'Cy', paid: 0, share: 1500, balance: -1500 },
];

test('R2.2 and R2.1 computeBalances: the paid amount and the share of each person are recomputed from the expenses', () => {
  assert.equal(checkBalances([parsedParty], rightRows), true);
  const row = (i, change) => rightRows.map((r, n) => (n === i ? { ...r, ...change } : r));

  // Two people's shares swapped: the balances still sum to zero, so only the share check can see it.
  const swapped = [
    { ...rightRows[0], share: 1501, balance: 1499 },
    { ...rightRows[1], share: 1000, balance: 1 },
    rightRows[2],
  ];
  assert.equal(swapped.reduce((total, r) => total + r.balance, 0), 0);
  const swap = checkBalances([parsedParty], swapped);
  assert.equal(swap.criterion, 'R2.1');
  assert.match(swap.reason, /Ann.*share.*1501.*1000/);

  const paid = checkBalances([parsedParty], [{ ...rightRows[0], paid: 2000, balance: 1000 }, rightRows[1], { ...rightRows[2], paid: 1000, balance: -500 }]);
  assert.equal(paid.criterion, 'R2.2');
  assert.match(paid.reason, /Ann.*paid.*2000.*3000/);

  // A balance that is not paid minus share, a row for someone else, and a missing row.
  const offBalance = checkBalances([parsedParty], [rightRows[0], { ...rightRows[1], balance: -499 }, { ...rightRows[2], balance: -1501 }]);
  assert.equal(offBalance.criterion, 'R2.2');
  assert.match(offBalance.reason, /Bob.*balance.*-499.*-500/);
  assert.match(checkBalances([parsedParty], row(1, { name: 'Zed' })).reason, /row 2.*Zed.*Bob/);
  const missing = checkBalances([parsedParty], [rightRows[0], { ...rightRows[1], balance: -2000 }]);
  assert.equal(missing.criterion, 'R2.2');
  assert.match(missing.reason, /2 rows.*3 people/);
});

test('R4.1 and R3.3 renderText: every balance row and payment line printed equals the guarded balances and payments', () => {
  const payments = [{ from: 'Cy', to: 'Ann', amount: 1500 }, { from: 'Bob', to: 'Ann', amount: 500 }];
  const text = renderText(rightRows, payments);
  assert.equal(checkAll(reportPostconditions.renderText, [rightRows, payments], text), true);
  assert.equal(checkAll(reportPostconditions.renderText, [rightRows.map((r) => ({ ...r, paid: 0, share: 0, balance: 0 })), []], renderText(rightRows.map((r) => ({ ...r, paid: 0, share: 0, balance: 0 })), [])), true);

  const halved = text.replace('Cy pays Ann 15.00', 'Cy pays Ann 7.50');
  const half = checkAll(reportPostconditions.renderText, [rightRows, payments], halved);
  assert.equal(half.criterion, 'R4.1');
  assert.match(half.reason, /reads "Cy pays Ann 7\.50".*should read "Cy pays Ann 15\.00"/);

  const row = checkAll(reportPostconditions.renderText, [rightRows, payments], text.replace('-15.00', '-5.00'));
  assert.equal(row.criterion, 'R4.1');
  assert.match(row.reason, /Cy/);

  const dropped = checkAll(reportPostconditions.renderText, [rightRows, payments], text.split('\n').slice(0, -1).join('\n'));
  assert.equal(dropped.criterion, 'R4.1');

  const square = checkAll(reportPostconditions.renderText, [rightRows, []], text);
  assert.ok(square !== true);
  assert.equal(checkAll(reportPostconditions.renderText, [rightRows, payments], 42).criterion, 'R4.1');
});

test('R4.2 renderJson: the balances and payments printed equal the guarded ones', () => {
  const payments = [{ from: 'Cy', to: 'Ann', amount: 1500 }];
  const json = renderJson(rightRows, payments);
  assert.equal(reportPostconditions.renderJson.check([rightRows, payments], json), true);
  const halved = JSON.stringify({ balances: rightRows, payments: [{ from: 'Cy', to: 'Ann', amount: 750 }] });
  assert.match(reportPostconditions.renderJson.check([rightRows, payments], halved), /payments/);
  const swapped = JSON.stringify({ balances: [{ ...rightRows[0], share: 1501 }, ...rightRows.slice(1)], payments });
  assert.match(reportPostconditions.renderJson.check([rightRows, payments], swapped), /balances/);
  assert.match(reportPostconditions.renderJson.check([rightRows, payments], 'not json'), /JSON/);
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
