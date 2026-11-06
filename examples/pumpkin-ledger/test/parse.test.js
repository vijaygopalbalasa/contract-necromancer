import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger } from '../src/parse.js';
import { LedgerError } from '../src/errors.js';

test('parseLedger records payer, cents and what for plain lines', () => {
  const { expenses } = parseLedger(
    ['Ann paid 12 for chips', 'Bob paid 12.5 for soda and ice'].join('\n'),
  );
  assert.deepEqual(expenses, [
    { payerKey: 'ann', cents: 1200, what: 'chips', sharerKeys: null },
    { payerKey: 'bob', cents: 1250, what: 'soda and ice', sharerKeys: null },
  ]);
});

test('parseLedger skips empty and # lines and counts them in line numbers', () => {
  const text = ['# party', '', '   ', 'Ann paid 5 for tea', '  # note', 'Bob paid 7 for pie', ''].join('\n');
  const parsed = parseLedger(text);
  assert.deepEqual(parsed.expenses, [
    { payerKey: 'ann', cents: 500, what: 'tea', sharerKeys: null },
    { payerKey: 'bob', cents: 700, what: 'pie', sharerKeys: null },
  ]);
  assert.deepEqual(parseLedger(''), { people: [], expenses: [] });
});

test('parseLedger reports bad lines with their 1-based line number', () => {
  const cases = [
    ['Ann paid 5 for tea\nbogus line', "Line 2: Write the line as '<payer> paid <amount> for <what>'."],
    ['# note\n\nAnn paid 0 for tea', 'Line 3: Amount must be more than zero.'],
    ['Ann paid 1.234 for tea', 'Line 1: Amount can have at most two decimals.'],
  ];
  for (const [text, message] of cases) {
    assert.throws(
      () => parseLedger(text),
      (err) => {
        assert.ok(err instanceof LedgerError);
        assert.equal(err.message, message);
        return true;
      },
    );
  }
});

test('parseLedger reads split lists and the people registry', () => {
  const parsed = parseLedger('Ann paid 30 for split bill split Ann,Bob\nBob paid 9 for tea');
  assert.deepEqual(parsed.expenses, [
    { payerKey: 'ann', cents: 3000, what: 'split bill', sharerKeys: ['ann', 'bob'] },
    { payerKey: 'bob', cents: 900, what: 'tea', sharerKeys: null },
  ]);
});

test('parseLedger treats case/space variants as one person with the first spelling', () => {
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
});

test('parseLedger rejects empty split entries with the line number', () => {
  assert.throws(
    () => parseLedger('Ann paid 5 for tea split Ann,,Bob'),
    (err) => {
      assert.ok(err instanceof LedgerError);
      assert.equal(err.message, 'Line 1: Split needs names separated by commas.');
      return true;
    },
  );
});
