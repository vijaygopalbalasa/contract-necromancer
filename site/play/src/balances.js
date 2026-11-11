import { splitExpense } from './split.js';

// Compute one balance row per person, in order of first appearance.
// A row is { name, paid, share, balance } with balance = paid - share.
// An expense without a split list is shared by everyone named in the file.
export function computeBalances({ people, expenses }) {
  const allKeys = people.map((p) => p.key);
  const paid = new Map(allKeys.map((k) => [k, 0]));
  const share = new Map(allKeys.map((k) => [k, 0]));

  for (const expense of expenses) {
    paid.set(expense.payerKey, paid.get(expense.payerKey) + expense.cents);
    const sharers = expense.sharerKeys ?? allKeys;
    const shares = splitExpense(expense.cents, sharers);
    for (const [key, amount] of shares) {
      share.set(key, share.get(key) + amount);
    }
  }

  return people.map((p) => {
    const paidCents = paid.get(p.key);
    const shareCents = share.get(p.key);
    return { name: p.name, paid: paidCents, share: shareCents, balance: paidCents - shareCents };
  });
}
