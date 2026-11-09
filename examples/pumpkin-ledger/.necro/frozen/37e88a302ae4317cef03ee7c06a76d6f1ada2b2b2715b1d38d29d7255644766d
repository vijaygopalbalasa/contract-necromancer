// Runtime postconditions for Pumpkin Ledger (Req 15 of the necro-core spec): Eiffel's `ensure`, checked on every real call.
// bin/ledger.js wraps splitExpense, computeBalances and settle with these through guard() from src/runtime.js, so a result
// that breaks a requirement stops the ledger with a ContractViolation instead of printing wrong numbers.
//
// Each entry is { criterion, check }. The check gets (args, result) and passes by returning true; a string it returns is the
// reason it failed. The criterion is the one of requirements.md that the check keeps.

// R5.1: the shares of an expense sum to its amount, and no two differ by more than one cent.
export const splitPostconditions = {
  splitExpense: {
    criterion: 'R5.1',
    check(args, result) {
      const [cents, sharerKeys] = args;
      if (!(result instanceof Map)) return 'the shares are not a Map from name to cents';
      if (sharerKeys.length === 0) return result.size === 0 || 'there are no sharers, so there should be no shares';
      const shares = [...result.values()];
      if (!shares.every((s) => Number.isInteger(s) && s >= 0)) return 'a share is not a whole number of cents';
      const sum = shares.reduce((total, s) => total + s, 0);
      if (sum !== cents) return `the shares of ${cents} cents add up to ${sum} cents`;
      const spread = Math.max(...shares) - Math.min(...shares);
      if (spread > 1) return `two shares differ by ${spread} cents, more than one cent`;
      return true;
    },
  },
};

// R2.2: the balances of everyone sum to exactly zero.
export const balancesPostconditions = {
  computeBalances: {
    criterion: 'R2.2',
    check(args, rows) {
      if (!Array.isArray(rows)) return 'the balances are not a list';
      const sum = rows.reduce((total, row) => total + row.balance, 0);
      return sum === 0 || `the balances add up to ${sum} cents, not zero`;
    },
  },
};

// R3.1: the payments are positive whole numbers of cents and bring every balance to zero.
export const settlePostconditions = {
  settle: {
    criterion: 'R3.1',
    check(args, payments) {
      const [rows] = args;
      if (!Array.isArray(payments)) return 'the payments are not a list';
      const left = new Map(rows.map((row) => [row.name, row.balance]));
      for (const p of payments) {
        if (!Number.isInteger(p.amount) || p.amount <= 0) return `a payment from ${p.from} to ${p.to} is not a positive whole number of cents`;
        if (!left.has(p.from) || !left.has(p.to)) return `a payment from ${p.from} to ${p.to} names someone with no balance`;
        left.set(p.from, left.get(p.from) + p.amount);
        left.set(p.to, left.get(p.to) - p.amount);
      }
      const unpaid = [...left].filter(([, balance]) => balance !== 0).map(([name, balance]) => `${name} ${balance}`);
      return unpaid.length === 0 || `the payments leave these balances unsettled: ${unpaid.join(', ')}`;
    },
  },
};
