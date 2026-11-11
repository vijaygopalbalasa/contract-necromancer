// Settle balances with a deterministic greedy rule: repeatedly move the smaller
// of (what the biggest debtor owes, what the biggest creditor is owed) from the
// biggest debtor to the biggest creditor. Ties break by name, case-insensitive.
// Returns payments [{ from, to, amount }] with positive integer amounts.
export function settle(balances) {
  const entries = balances.map((r) => ({ name: r.name, balance: r.balance }));
  const total = entries.reduce((s, e) => s + e.balance, 0);
  if (total !== 0) {
    throw new Error('Balances must sum to zero to settle.');
  }

  const nameKey = (name) => name.toLowerCase();
  const payments = [];

  while (true) {
    let creditor = null;
    let debtor = null;
    for (const e of entries) {
      if (e.balance > 0) {
        if (
          creditor === null ||
          e.balance > creditor.balance ||
          (e.balance === creditor.balance && nameKey(e.name) < nameKey(creditor.name))
        ) {
          creditor = e;
        }
      } else if (e.balance < 0) {
        if (
          debtor === null ||
          e.balance < debtor.balance ||
          (e.balance === debtor.balance && nameKey(e.name) < nameKey(debtor.name))
        ) {
          debtor = e;
        }
      }
    }

    if (creditor === null || debtor === null) break;

    const amount = Math.min(creditor.balance, -debtor.balance);
    payments.push({ from: debtor.name, to: creditor.name, amount });
    creditor.balance -= amount;
    debtor.balance += amount;
  }

  return payments;
}
