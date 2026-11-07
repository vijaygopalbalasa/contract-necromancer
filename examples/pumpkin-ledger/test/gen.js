// Seeded party generator, property runner and shrinker. Built-ins only.
//
// A party is plain data:
//   { expenses: [{ payer, cents, fmt, split, what, gap }] }
// payer and split entries are name spellings (case and spaces vary). split is
// null for "everyone". fmt picks how the amount is written. gap is 0 for none,
// 1 for a blank line before the expense, 2 for a comment line before it.
// partyToText turns a party into ledger text.

export const DEFAULT_SEED = 20261031;
export const DEFAULT_RUNS = 300;
export const LIMITS = {
  minPeople: 1,
  maxPeople: 12,
  minExpenses: 1,
  maxExpenses: 30,
  minCents: 1,
  maxCents: 999999,
};

const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lou'];
const PLAIN_WHAT = ['pizza', 'cab ride', 'tickets', 'snacks', 'hall hire'];
const SPLIT_WHAT = ['split the bill', 'cab split in two', 'tickets'];

export const keyOf = (name) => name.trim().toLowerCase();

// mulberry32. The only place a float appears is turning random bits into a unit
// interval for choices; amounts are always integers.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (items) => items[int(0, items.length - 1)];
  const chance = (p) => next() < p;
  const shuffle = (items) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, chance, shuffle };
}

// The seed of run i. Run 0 uses the base seed itself, so replaying a reported
// case seed with runs = 1 regenerates exactly the failing party.
export const caseSeedOf = (seed, i) => (seed + Math.imul(i, 0x9e3779b1)) >>> 0;

function spell(rng, name, pad) {
  const styled = rng.pick([name, name.toLowerCase(), name.toUpperCase()]);
  return pad && rng.chance(0.3) ? ` ${styled} ` : styled;
}

function genCents(rng) {
  const roll = rng.next();
  if (roll < 0.05) return LIMITS.minCents;
  if (roll < 0.1) return LIMITS.maxCents;
  if (roll < 0.4) return rng.int(1, 1000);
  return rng.int(LIMITS.minCents, LIMITS.maxCents);
}

export function generateParty(rng) {
  const n = rng.int(LIMITS.minPeople, LIMITS.maxPeople);
  const people = rng.shuffle(NAMES).slice(0, n);
  const count = rng.int(LIMITS.minExpenses, LIMITS.maxExpenses);
  // Some parties use a few round amounts, so several people end with equal balances.
  const round = rng.chance(0.3);
  const expenses = [];
  for (let i = 0; i < count; i++) {
    let split = null;
    if (!rng.chance(round ? 0.7 : 0.35)) {
      const size = rng.int(1, n);
      split = rng.shuffle(people).slice(0, size).map((p) => spell(rng, p, true));
      // Now and then repeat a person under another spelling.
      if (rng.chance(0.1)) split.push(spell(rng, rng.pick(people), true));
    }
    expenses.push({
      payer: spell(rng, rng.pick(people), false),
      cents: round ? rng.pick([600, 1200, 2400]) : genCents(rng),
      fmt: rng.int(0, 1),
      split,
      what: rng.pick(split === null ? PLAIN_WHAT : SPLIT_WHAT),
      gap: rng.chance(0.15) ? rng.int(1, 2) : 0,
    });
  }
  return { expenses };
}

// Write cents as text with integer arithmetic only.
// fmt 0 is the shortest form (12, 12.5, 12.05), fmt 1 always has two decimals.
export function amountText(cents, fmt) {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const two = String(frac).padStart(2, '0');
  if (fmt === 1) return `${whole}.${two}`;
  if (frac === 0) return `${whole}`;
  if (frac % 10 === 0) return `${whole}.${Math.floor(frac / 10)}`;
  return `${whole}.${two}`;
}

export function partyToText(party) {
  const lines = [];
  for (const e of party.expenses) {
    if (e.gap === 1) lines.push('');
    if (e.gap === 2) lines.push('# a note that is not an expense');
    let line = `${e.payer} paid ${amountText(e.cents, e.fmt)} for ${e.what}`;
    if (e.split !== null) line += ` split ${e.split.join(',')}`;
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

export const peopleOf = (party) => [
  ...new Set(party.expenses.flatMap((e) => [e.payer, ...(e.split ?? [])]).map(keyOf)),
];

// The same expenses in another order, chosen by the rng.
export const reorder = (party, rng) => ({ ...party, expenses: rng.shuffle(party.expenses) });

function withoutPerson(party, key) {
  const expenses = party.expenses
    .filter((e) => keyOf(e.payer) !== key)
    .map((e) => (e.split === null ? e : { ...e, split: e.split.filter((s) => keyOf(s) !== key) }))
    .filter((e) => e.split === null || e.split.length > 0);
  return { ...party, expenses };
}

// Smaller parties to try, most drastic first: fewer people, fewer expenses,
// simpler splits, smaller amounts.
export function shrinkCandidates(party) {
  const out = [];
  const keys = peopleOf(party);
  if (keys.length > 1) for (const key of keys) out.push(withoutPerson(party, key));
  if (party.expenses.length > 1) {
    party.expenses.forEach((_, i) =>
      out.push({ ...party, expenses: party.expenses.filter((__, j) => j !== i) }),
    );
  }
  const change = (i, patch) =>
    out.push({ ...party, expenses: party.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  party.expenses.forEach((e, i) => {
    if (e.split !== null) {
      change(i, { split: null });
      if (e.split.length > 1) e.split.forEach((_, k) => change(i, { split: e.split.filter((__, m) => m !== k) }));
    }
    if (e.cents > 1) {
      change(i, { cents: 1 });
      change(i, { cents: Math.floor(e.cents / 2) });
      change(i, { cents: e.cents - 1 });
    }
    if (e.gap !== 0) change(i, { gap: 0 });
  });
  return out.filter((p) => p.expenses.length > 0);
}

// Greedy shrink: keep taking the first smaller party that still fails.
export function shrink(party, fails, budget = 5000) {
  let current = party;
  outer: while (budget > 0) {
    for (const candidate of shrinkCandidates(current)) {
      if (budget-- <= 0) break outer;
      if (fails(candidate)) {
        current = candidate;
        continue outer;
      }
    }
    break;
  }
  return current;
}

export class PropertyFailure extends Error {
  constructor(details) {
    const { name, seed, runs, runIndex, caseSeed, party, reason } = details;
    const people = peopleOf(party).length;
    super(
      [
        `Property "${name}" failed on case ${runIndex + 1} of ${runs}.`,
        `seed: ${seed} (replay with seed ${caseSeed} and runs 1)`,
        `reason: ${reason}`,
        `smallest failing party (${people} ${people === 1 ? 'person' : 'people'}, ${party.expenses.length} ${party.expenses.length === 1 ? 'expense' : 'expenses'}):`,
        partyToText(party).trimEnd(),
      ].join('\n'),
    );
    this.name = 'PropertyFailure';
    Object.assign(this, { seed, runs, runIndex, caseSeed, party, reason });
  }
}

const attempt = (property, party) => {
  try {
    property(party);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

// Run property(party) on `runs` generated parties. The property throws to
// signal a violation. On the first failure, shrink and throw a PropertyFailure
// that carries the seed and the smallest failing party. Returns the run count.
export function checkProperty(name, property, options = {}) {
  const { seed = DEFAULT_SEED, runs = DEFAULT_RUNS, generate = generateParty } = options;
  for (let i = 0; i < runs; i++) {
    const caseSeed = caseSeedOf(seed, i);
    const party = generate(createRng(caseSeed));
    const reason = attempt(property, party);
    if (reason === null) continue;
    const smallest = shrink(party, (p) => attempt(property, p) !== null);
    throw new PropertyFailure({
      name,
      seed,
      runs,
      runIndex: i,
      caseSeed,
      party: smallest,
      reason: attempt(property, smallest) ?? reason,
    });
  }
  return runs;
}
