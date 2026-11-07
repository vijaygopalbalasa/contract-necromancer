// Contract for Requirement 5: Properties that hold for every party.
// Modules are imported inside each test so the test names register while src/ is empty.
// The property checks are written out here; only the seeded generator, the runner and
// the shrinker come from test/gen.js, and the contract checks that they behave as R5 says.
import test from 'node:test';
import assert from 'node:assert/strict';

const SEED = 20261031;
const RUNS = 300;

const sum = (items) => items.reduce((s, x) => s + x, 0);

// Run a property on RUNS generated parties and prove it was really called that often.
async function forEveryParty(name, property) {
  // from '../../test/gen.js'
  const { checkProperty } = await import('../../test/gen.js');
  let calls = 0;
  const ran = checkProperty(name, (party) => {
    calls += 1;
    property(party);
  }, { seed: SEED, runs: RUNS });
  assert.ok(calls >= RUNS, `property ran on ${calls} parties, expected at least ${RUNS}`);
  assert.ok(ran >= RUNS);
}

// Check that the generator honours the ranges in R5.1 and writes text the parser accepts.
async function assertGeneratorRanges() {
  // from '../../test/gen.js'
  const { generateParty, createRng, caseSeedOf, partyToText, peopleOf } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  let sawOne = false;
  let sawMany = false;
  let sawSplit = false;
  let sawNoSplit = false;
  let sawSpacing = false;
  let sawCaseVariants = false;
  for (let i = 0; i < RUNS; i++) {
    const party = generateParty(createRng(caseSeedOf(SEED, i)));
    const people = peopleOf(party).length;
    assert.ok(people >= 1 && people <= 12, `${people} people`);
    assert.ok(party.expenses.length >= 1 && party.expenses.length <= 30, `${party.expenses.length} expenses`);
    for (const e of party.expenses) {
      assert.ok(Number.isInteger(e.cents) && e.cents >= 1 && e.cents <= 999999, `amount ${e.cents}`);
      if (e.split === null) sawNoSplit = true;
      else sawSplit = true;
      if (e.split?.some((n) => n !== n.trim())) sawSpacing = true;
    }
    const spellings = new Map();
    for (const e of party.expenses) {
      for (const n of [e.payer, ...(e.split ?? [])]) {
        const set = spellings.get(n.trim().toLowerCase()) ?? new Set();
        set.add(n.trim());
        spellings.set(n.trim().toLowerCase(), set);
      }
    }
    if ([...spellings.values()].some((s) => s.size > 1)) sawCaseVariants = true;
    if (people === 1) sawOne = true;
    if (people >= 10) sawMany = true;
    const parsed = parseLedger(partyToText(party));
    assert.equal(parsed.expenses.length, party.expenses.length);
    assert.equal(parsed.people.length, people);
  }
  assert.ok(sawOne && sawMany, 'party sizes should span the range');
  assert.ok(sawSplit && sawNoSplit, 'both split and shared expenses should appear');
  assert.ok(sawSpacing && sawCaseVariants, 'name spellings should vary');

  // Same seed, same party.
  assert.deepEqual(generateParty(createRng(SEED)), generateParty(createRng(SEED)));
}

test('R5.1 shares of every expense sum to its amount and differ by at most one cent', async () => {
  await assertGeneratorRanges();
  // from '../../test/gen.js'
  const { partyToText } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');
  // from '../../src/split.js'
  const { splitExpense } = await import('../../src/split.js');

  await forEveryParty('R5.1 shares', (party) => {
    const parsed = parseLedger(partyToText(party));
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
    // The shares that end up in the balances add up to everything that was spent.
    const rows = computeBalances(parsed);
    assert.equal(sum(rows.map((r) => r.share)), sum(parsed.expenses.map((e) => e.cents)));
  });
});

test('R5.2 balances are paid minus shares and sum to exactly zero', async () => {
  // from '../../test/gen.js'
  const { partyToText, peopleOf, keyOf } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');

  await forEveryParty('R5.2 balances', (party) => {
    const rows = computeBalances(parseLedger(partyToText(party)));
    assert.equal(sum(rows.map((r) => r.balance)), 0, 'balances must sum to zero');

    // An independent calculation from the party data: floor(amount / N) each,
    // the remaining cents one each to the first sharers in alphabetical order.
    const everyone = peopleOf(party).sort();
    const want = new Map(everyone.map((k) => [k, { paid: 0, share: 0 }]));
    for (const e of party.expenses) {
      want.get(keyOf(e.payer)).paid += e.cents;
      const sharers = e.split === null ? everyone : [...new Set(e.split.map(keyOf))].sort();
      const base = Math.floor(e.cents / sharers.length);
      const extra = e.cents - base * sharers.length;
      sharers.forEach((k, i) => {
        want.get(k).share += base + (i < extra ? 1 : 0);
      });
    }
    assert.equal(rows.length, want.size, 'one row per person');
    for (const r of rows) {
      const expected = want.get(keyOf(r.name));
      assert.equal(r.balance, r.paid - r.share, `${r.name}: balance is paid minus share`);
      assert.deepEqual([r.paid, r.share], [expected.paid, expected.share], `${r.name}: paid and share`);
    }
  });
});

test('R5.3 settling zeroes every balance with positive whole-cent payments, at most one fewer than people owing or owed', async () => {
  // from '../../test/gen.js'
  const { partyToText } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');
  // from '../../src/settle.js'
  const { settle } = await import('../../src/settle.js');

  await forEveryParty('R5.3 settle', (party) => {
    const rows = computeBalances(parseLedger(partyToText(party)));
    const payments = settle(rows.map((r) => ({ ...r })));
    const left = new Map(rows.map((r) => [r.name, r.balance]));
    for (const { from, to, amount } of payments) {
      assert.ok(Number.isSafeInteger(amount) && amount > 0, `payment ${amount} must be a positive whole number`);
      assert.ok(left.has(from) && left.has(to) && from !== to, 'a payment names two different people');
      left.set(from, left.get(from) + amount);
      left.set(to, left.get(to) - amount);
    }
    for (const [name, rest] of left) assert.equal(rest, 0, `${name} should end at zero`);
    const open = rows.filter((r) => r.balance !== 0).length;
    assert.ok(payments.length <= Math.max(open - 1, 0), `${payments.length} payments for ${open} people`);
  });
});

test('R5.4 reading the same file twice, or its lines in another order, gives the same balances', async () => {
  // from '../../test/gen.js'
  const { partyToText, reorder, createRng, caseSeedOf, keyOf } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');
  // from '../../src/balances.js'
  const { computeBalances } = await import('../../src/balances.js');
  // from '../../src/settle.js'
  const { settle } = await import('../../src/settle.js');
  // from '../../src/report.js'
  const { renderText, renderJson } = await import('../../src/report.js');

  const run = (text) => {
    const rows = computeBalances(parseLedger(text));
    const payments = settle(rows.map((r) => ({ ...r })));
    return { rows, payments, text: renderText(rows, payments), json: renderJson(rows, payments) };
  };
  // Row order and the shown spelling follow the first appearance, so compare per person.
  const byPerson = (rows) =>
    Object.fromEntries(rows.map((r) => [keyOf(r.name), [r.paid, r.share, r.balance]]));

  let reordered = 0;
  await forEveryParty('R5.4 determinism', (party) => {
    const text = partyToText(party);
    const a = run(text);
    const b = run(text);
    assert.deepEqual(a.rows, b.rows);
    assert.deepEqual(a.payments, b.payments);
    assert.equal(a.text, b.text);
    assert.equal(a.json, b.json);

    const rng = createRng(caseSeedOf(SEED, reordered++));
    const other = run(partyToText(reorder(party, rng)));
    assert.deepEqual(byPerson(other.rows), byPerson(a.rows), 'another line order must give the same balances');
  });
});

test('R5.5 a failing property reports the seed and the smallest failing party so it can be replayed', async () => {
  // from '../../test/gen.js'
  const { checkProperty, partyToText } = await import('../../test/gen.js');
  // from '../../src/parse.js'
  const { parseLedger } = await import('../../src/parse.js');

  // A deliberately wrong splitter: rounds instead of flooring, so shares can overshoot.
  const brokenSharesSum = (text) => {
    const { expenses, people } = parseLedger(text);
    for (const e of expenses) {
      const n = (e.sharerKeys ?? people).length;
      const total = Math.round(e.cents / n) * n + (e.cents % n);
      assert.equal(total, e.cents, `shares of ${e.cents} cents over ${n} people add to ${total}`);
    }
  };
  const property = (party) => brokenSharesSum(partyToText(party));

  let failure;
  try {
    checkProperty('broken split', property, { seed: SEED, runs: RUNS });
  } catch (err) {
    failure = err;
  }
  assert.ok(failure, 'a wrong splitter must make the property fail');
  const message = String(failure.message);

  // The report names the seed.
  assert.ok(message.includes(`seed: ${SEED}`), 'the report must name the seed');

  // The report prints the smallest failing party as ledger text, and that text fails on its own.
  const marker = /smallest failing party[^\n]*\n/.exec(message);
  assert.ok(marker, 'the report must show the smallest failing party');
  const printed = message.slice(marker.index + marker[0].length) + '\n';
  const lines = printed.split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length >= 1 && lines.length <= 5, `expected a small party, got ${lines.length} lines`);
  assert.throws(() => brokenSharesSum(printed), 'the printed party must still fail');

  // Replay: the reported case seed with one run fails again with the same party.
  assert.ok(Number.isInteger(failure.caseSeed), 'the report must give a replay seed');
  let replay;
  try {
    checkProperty('broken split', property, { seed: failure.caseSeed, runs: 1 });
  } catch (err) {
    replay = err;
  }
  assert.ok(replay, 'replaying the reported seed must fail again');
  assert.equal(replay.caseSeed, failure.caseSeed);
  assert.equal(partyToText(replay.party), partyToText(failure.party));
});
