import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger } from '../src/parse.js';
import { computeBalances } from '../src/balances.js';
import { splitExpense } from '../src/split.js';
import { settle } from '../src/settle.js';
import { renderJson, renderText } from '../src/report.js';
import {
  DEFAULT_RUNS,
  DEFAULT_SEED,
  LIMITS,
  PropertyFailure,
  caseSeedOf,
  checkProperty,
  createRng,
  generateParty,
  keyOf,
  partyToText,
  peopleOf,
  reorder,
} from './gen.js';

// PUMPKIN_SEED=<number> explores another seed; the default is fixed.
const SEED = process.env.PUMPKIN_SEED === undefined ? DEFAULT_SEED : Number(process.env.PUMPKIN_SEED);
const RUNS = DEFAULT_RUNS;

const balancesOf = (text) => {
  const parsed = parseLedger(text);
  return { parsed, balances: computeBalances(parsed) };
};

const pipeline = (text) => {
  const { parsed, balances } = balancesOf(text);
  return { parsed, balances, payments: settle(balances.map((b) => ({ ...b }))) };
};

// An independent calculation of paid and share per person key, straight from the
// party data: floor(amount / N) each, the remaining cents to the first keys in order.
function expected(party) {
  const everyone = peopleOf(party).sort();
  const rows = new Map(everyone.map((k) => [k, { paid: 0, share: 0 }]));
  for (const e of party.expenses) {
    rows.get(keyOf(e.payer)).paid += e.cents;
    const sharers = e.split === null ? everyone : [...new Set(e.split.map(keyOf))].sort();
    const base = Math.floor(e.cents / sharers.length);
    const extra = e.cents - base * sharers.length;
    sharers.forEach((k, i) => {
      rows.get(k).share += base + (i < extra ? 1 : 0);
    });
  }
  return rows;
}

const sum = (items) => items.reduce((s, x) => s + x, 0);

test('generator stays inside the limits of requirement 5.1', () => {
  let maxPeople = 0;
  let minPeople = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const party = generateParty(createRng(caseSeedOf(SEED, i)));
    const people = peopleOf(party).length;
    maxPeople = Math.max(maxPeople, people);
    minPeople = Math.min(minPeople, people);
    assert.ok(people >= LIMITS.minPeople && people <= LIMITS.maxPeople);
    assert.ok(party.expenses.length >= LIMITS.minExpenses && party.expenses.length <= LIMITS.maxExpenses);
    for (const e of party.expenses) {
      assert.ok(Number.isInteger(e.cents) && e.cents >= 1 && e.cents <= 999999);
    }
  }
  assert.equal(minPeople, 1);
  assert.ok(maxPeople >= 10, `largest party had only ${maxPeople} people`);
});

test('generator output is the same for the same seed', () => {
  assert.deepEqual(generateParty(createRng(99)), generateParty(createRng(99)));
  assert.notDeepEqual(generateParty(createRng(99)), generateParty(createRng(100)));
});

test('R5.1 shares of each expense sum to its amount and differ by at most one cent', () => {
  const runs = checkProperty('R5.1 shares', (party) => {
    const { parsed, balances } = balancesOf(partyToText(party));
    const everyone = parsed.people.map((p) => p.key);
    for (const expense of parsed.expenses) {
      const sharers = expense.sharerKeys ?? everyone;
      const shares = [...splitExpense(expense.cents, sharers).values()];
      assert.equal(shares.length, sharers.length, 'every sharer gets a share');
      assert.equal(sum(shares), expense.cents, `shares of ${expense.cents} cents must sum to it`);
      assert.ok(
        Math.max(...shares) - Math.min(...shares) <= 1,
        `shares ${shares.join(',')} differ by more than one cent`,
      );
    }
    assert.equal(sum(balances.map((b) => b.share)), sum(parsed.expenses.map((e) => e.cents)));
  }, { seed: SEED, runs: RUNS });
  assert.equal(runs, RUNS);
});

test('R5.2 balances sum to exactly zero', () => {
  checkProperty('R5.2 balances', (party) => {
    const { balances } = balancesOf(partyToText(party));
    assert.equal(sum(balances.map((b) => b.balance)), 0, 'balances must sum to zero');
    const want = expected(party);
    assert.equal(balances.length, want.size, 'one row per person');
    for (const b of balances) {
      const row = want.get(keyOf(b.name));
      assert.equal(b.balance, b.paid - b.share, `${b.name}: balance is paid - share`);
      assert.deepEqual([b.paid, b.share], [row.paid, row.share], `${b.name}: paid and share`);
    }
  }, { seed: SEED, runs: RUNS });
});

test('R5.3 settling zeroes every balance with few positive whole-cent payments', () => {
  checkProperty('R5.3 settle', (party) => {
    const { balances, payments } = pipeline(partyToText(party));
    const left = new Map(balances.map((b) => [b.name, b.balance]));
    for (const { from, to, amount } of payments) {
      assert.ok(Number.isSafeInteger(amount) && amount > 0, `payment ${amount} must be a positive whole number`);
      assert.ok(left.has(from) && left.has(to) && from !== to, 'payment names two different people');
      left.set(from, left.get(from) + amount);
      left.set(to, left.get(to) - amount);
    }
    for (const [name, rest] of left) assert.equal(rest, 0, `${name} should end at zero`);
    const open = balances.filter((b) => b.balance !== 0).length;
    assert.ok(payments.length <= Math.max(open - 1, 0), `${payments.length} payments for ${open} people`);
  }, { seed: SEED, runs: RUNS });
});

test('R5.4 same file twice gives the same output, and another line order the same balances', () => {
  checkProperty('R5.4 determinism', (party) => {
    const text = partyToText(party);
    const first = pipeline(text);
    const second = pipeline(text);
    assert.deepEqual(first.balances, second.balances);
    assert.deepEqual(first.payments, second.payments);
    assert.equal(renderText(first.balances, first.payments), renderText(second.balances, second.payments));
    assert.equal(renderJson(first.balances, first.payments), renderJson(second.balances, second.payments));

    // Another line order: the same figures per person. Row order and the shown
    // spelling follow first appearance, so compare by person key.
    const byKey = (balances) =>
      Object.fromEntries(balances.map((b) => [keyOf(b.name), [b.paid, b.share, b.balance]]));
    const rng = createRng(caseSeedOf(SEED, 7) ^ party.expenses.length);
    const shuffled = pipeline(partyToText(reorder(party, rng)));
    assert.deepEqual(byKey(shuffled.balances), byKey(first.balances));
  }, { seed: SEED, runs: RUNS });
});

test('R5.5 a failing property reports the seed and the smallest failing party', () => {
  // Fails whenever any expense is 5000 cents or more.
  const property = (party) => {
    for (const e of party.expenses) assert.ok(e.cents < 5000, `expense of ${e.cents} cents is too big`);
  };
  let failure;
  try {
    checkProperty('big expense', property, { seed: 4242, runs: RUNS });
  } catch (err) {
    failure = err;
  }
  assert.ok(failure instanceof PropertyFailure, 'the property must fail');
  assert.match(failure.message, /seed: 4242/);
  assert.match(failure.message, new RegExp(`seed ${failure.caseSeed} and runs 1`));
  assert.equal(failure.party.expenses.length, 1);
  assert.equal(failure.party.expenses[0].cents, 5000);
  assert.equal(failure.party.expenses[0].split, null);
  assert.match(failure.message, / paid 50(\.00)? for /, 'the smallest party is printed as ledger text');

  // Replaying the reported case seed with one run fails the same way.
  assert.throws(
    () => checkProperty('big expense', property, { seed: failure.caseSeed, runs: 1 }),
    (err) => err instanceof PropertyFailure && err.caseSeed === failure.caseSeed,
  );
});

test('shrinking drops people, expenses and amounts', () => {
  // Fails when two different people appear: smallest is one expense naming two people.
  const property = (party) => assert.ok(peopleOf(party).length < 2, 'two people');
  let failure;
  try {
    checkProperty('two people', property, { seed: 1, runs: RUNS });
  } catch (err) {
    failure = err;
  }
  assert.ok(failure instanceof PropertyFailure);
  assert.equal(peopleOf(failure.party).length, 2);
  assert.equal(failure.party.expenses.length, 1);
  assert.equal(failure.party.expenses[0].cents, 1);
});
