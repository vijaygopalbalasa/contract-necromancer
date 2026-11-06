import test from 'node:test';
import assert from 'node:assert/strict';
import { renderText, renderJson } from '../src/report.js';

const BALANCES = [
  { name: 'Ann', paid: 1000, share: 334, balance: 666 },
  { name: 'Bob', paid: 0, share: 333, balance: -333 },
  { name: 'Cy', paid: 0, share: 333, balance: -333 },
];
const PAYMENTS = [
  { from: 'Bob', to: 'Ann', amount: 333 },
  { from: 'Cy', to: 'Ann', amount: 333 },
];

const tokens = (line) => line.trim().split(/\s+/);

test('renderText has a header, data rows with two decimals, then payment lines', () => {
  const lines = renderText(BALANCES, PAYMENTS).split('\n').filter((l) => l.trim() !== '');
  const find = (want) => lines.findIndex((l) => JSON.stringify(tokens(l)) === JSON.stringify(want));
  assert.ok(find(['Name', 'Paid', 'Share', 'Balance']) >= 0);
  assert.ok(find(['Ann', '10.00', '3.34', '6.66']) >= 0);
  const paymentLines = lines.filter((l) => l.includes(' pays ')).map((l) => l.trim());
  assert.deepEqual(paymentLines, ['Bob pays Ann 3.33', 'Cy pays Ann 3.33']);
});

test('renderText prints All square. and no payments when settled', () => {
  const lines = renderText(BALANCES, []).split('\n').map((l) => l.trim());
  assert.ok(lines.includes('All square.'));
  assert.ok(!lines.some((l) => l.includes(' pays ')));
});

test('renderJson parses to {balances, payments} with integer cents', () => {
  const direct = JSON.parse(renderJson(BALANCES, PAYMENTS));
  assert.deepEqual(direct, { balances: BALANCES, payments: PAYMENTS });
  assert.deepEqual(Object.keys(direct), ['balances', 'payments']);
  const square = JSON.parse(renderJson([{ name: 'Ann', paid: 0, share: 0, balance: 0 }], []));
  assert.deepEqual(square.payments, []);
});
