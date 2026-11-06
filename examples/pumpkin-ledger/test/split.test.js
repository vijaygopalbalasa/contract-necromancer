import test from 'node:test';
import assert from 'node:assert/strict';
import { splitExpense } from '../src/split.js';

const shares = (cents, keys) => Object.fromEntries(splitExpense(cents, keys));

test('splitExpense gives the floor and hands extra cents to the first keys in order', () => {
  assert.deepEqual(shares(100, ['a', 'b', 'c']), { a: 34, b: 33, c: 33 });
  assert.deepEqual(shares(1, ['g', 'f', 'e', 'd', 'c', 'b', 'a']), {
    a: 1, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0,
  });
  assert.deepEqual(shares(1000, ['bob', 'ann']), { ann: 500, bob: 500 });
});

test('splitExpense sorts keys by code unit and is case-sensitive on keys (keys are lowercase)', () => {
  assert.deepEqual(shares(1000, ['cy', 'ann', 'bob']), { ann: 334, bob: 333, cy: 333 });
});

test('splitExpense shares always sum to the amount over awkward inputs', () => {
  const cases = [
    [100, ['a', 'b', 'c']],
    [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    [1000, ['a', 'b', 'c', 'd', 'e', 'f']],
    [401, ['bob', 'cy']],
    [1, ['only']],
  ];
  for (const [cents, keys] of cases) {
    const map = splitExpense(cents, keys);
    const total = [...map.values()].reduce((s, v) => s + v, 0);
    assert.equal(total, cents);
    for (const v of map.values()) assert.ok(Number.isInteger(v) && v >= 0);
  }
});
