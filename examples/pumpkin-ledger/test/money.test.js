import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatCents } from '../src/money.js';
import { LedgerError } from '../src/errors.js';

test('parseAmount reads numbers with at most two decimals as integer cents', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('0.05'), 5);
});

test('parseAmount rejects bad amounts with the right LedgerError message', () => {
  const cases = [
    ['0', 'Amount must be more than zero.'],
    ['0.00', 'Amount must be more than zero.'],
    ['-3', 'Amount must be more than zero.'],
    ['1.234', 'Amount can have at most two decimals.'],
    ['abc', 'Amount is not a number like 12 or 12.50.'],
    ['12.', 'Amount is not a number like 12 or 12.50.'],
    ['.5', 'Amount is not a number like 12 or 12.50.'],
  ];
  for (const [text, message] of cases) {
    assert.throws(
      () => parseAmount(text),
      (err) => {
        assert.ok(err instanceof LedgerError, `LedgerError expected for ${JSON.stringify(text)}`);
        assert.equal(err.message, message);
        return true;
      },
    );
  }
});

test('formatCents writes integer cents with two decimals and a sign', () => {
  assert.equal(formatCents(1250), '12.50');
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatCents(-505), '-5.05');
});
