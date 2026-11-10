// Runtime postconditions for Pumpkin Ledger (Req 15 of the necro-core spec): Eiffel's `ensure`, checked on every real call.
// bin/ledger.js wraps parseLedger, splitExpense, computeBalances, settle, renderText and renderJson with these through guard()
// from src/runtime.js, so a result that breaks a requirement stops the ledger with a ContractViolation instead of printing
// wrong numbers. Every function whose result reaches a user is guarded; a function with no entry here is not protected.
//
// Each entry is { criterion, check } or a list of them. The check gets (args, result) and passes by returning true; a string it returns is the
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

// The checks below recompute their own numbers, from the text or from the parsed expenses they are given. They import nothing
// from src/, so code under test cannot change what a check expects.

// The ledger text read again, by the check itself: one entry per expense line with its payer, its amount in cents and its
// split list, and the people in order of first appearance. A line that cannot be read comes back as `unreadable`.
function centsOf(text) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

function readAgain(text) {
  const people = [];
  const known = new Set();
  const register = (name) => {
    const key = name.trim().toLowerCase();
    if (!known.has(key)) {
      known.add(key);
      people.push({ key, name: name.trim() });
    }
    return key;
  };
  const expenses = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(.+?)\s+paid\s+(\S+)\s+for\s+(.+)$/.exec(line);
    const cents = match ? centsOf(match[2]) : null;
    if (cents === null) return { people, expenses, unreadable: i + 1 };
    const payerKey = register(match[1]);
    let sharerKeys = null;
    const split = /^(.*)\s+split\s+(.+)$/.exec(match[3]);
    if (split) {
      sharerKeys = [];
      for (const raw of split[2].split(',')) {
        if (raw.trim() === '') return { people, expenses, unreadable: i + 1 };
        const key = register(raw);
        if (!sharerKeys.includes(key)) sharerKeys.push(key);
      }
    }
    expenses.push({ line: i + 1, payerKey, cents, sharerKeys });
  }
  return { people, expenses, unreadable: null };
}

// Why a result cannot be the parsed ledger { people, expenses }, or null when it has that shape.
function shapeProblem(result) {
  if (result === null || typeof result !== 'object' || !Array.isArray(result.people) || !Array.isArray(result.expenses)) {
    return 'the parsed ledger is not an object with a list of people and a list of expenses';
  }
  return null;
}

// The parser (Req 15.10). Every later check takes the parsed expenses as the truth, so a parser that changes an amount would
// move every number after it and still agree with itself. These checks read the input text again and compare.
// R1.1 and R1.4: every line of the text is read as one expense with its payer and its amount in cents, and a line that
//                cannot be read is not accepted.
// R1.2: each expense is shared among the names after `split`, or among everyone when it has no list.
// R1.3: people are one per name, ignoring case and surrounding spaces, in order of first appearance, with the first spelling.
// R1.5: empty lines and lines that start with # are skipped (an expense is one per other line).
export const parsePostconditions = {
  parseLedger: [
    {
      criterion: 'R1.4',
      check([text]) {
        const again = readAgain(text);
        return again.unreadable === null || `line ${again.unreadable} cannot be read, but the parser accepted it`;
      },
    },
    {
      criterion: 'R1.1',
      check([text], result) {
        const bad = shapeProblem(result);
        if (bad !== null) return bad;
        const again = readAgain(text);
        if (result.expenses.length !== again.expenses.length) {
          return `the text has ${again.expenses.length} expenses, but the parser returned ${result.expenses.length}`;
        }
        for (let i = 0; i < again.expenses.length; i++) {
          const want = again.expenses[i];
          const got = result.expenses[i];
          if (got === null || typeof got !== 'object') return `expense ${i + 1} is not an object`;
          if (got.payerKey !== want.payerKey) return `line ${want.line} was paid by ${want.payerKey}, but the parser says ${got.payerKey}`;
          if (got.cents !== want.cents) return `line ${want.line} is ${want.cents} cents, but the parser says ${got.cents} cents`;
        }
        return true;
      },
    },
    {
      criterion: 'R1.2',
      check([text], result) {
        const bad = shapeProblem(result);
        if (bad !== null) return bad;
        const again = readAgain(text);
        if (result.expenses.length !== again.expenses.length) return 'the parser returned another number of expenses than the text has';
        for (let i = 0; i < again.expenses.length; i++) {
          const want = again.expenses[i].sharerKeys;
          const got = result.expenses[i] && result.expenses[i].sharerKeys;
          const same = want === null ? got === null : Array.isArray(got) && got.length === want.length && want.every((k, j) => got[j] === k);
          if (!same) {
            const show = (keys) => (keys === null ? 'everyone' : Array.isArray(keys) ? keys.join(', ') : String(keys));
            return `line ${again.expenses[i].line} is shared by ${show(want)}, but the parser says ${show(got)}`;
          }
        }
        return true;
      },
    },
    {
      criterion: 'R1.3',
      check([text], result) {
        const bad = shapeProblem(result);
        if (bad !== null) return bad;
        const again = readAgain(text);
        if (result.people.length !== again.people.length) return `the text names ${again.people.length} people, but the parser returned ${result.people.length}`;
        for (let i = 0; i < again.people.length; i++) {
          const want = again.people[i];
          const got = result.people[i];
          if (got === null || typeof got !== 'object' || got.key !== want.key || got.name !== want.name) {
            return `person ${i + 1} should be ${want.name}, but the parser says ${got && got.name}`;
          }
        }
        return true;
      },
    },
  ],
};

// What each person paid, in cents: the sum of the expenses they paid, read from the expenses given.
function expectedPaid({ people, expenses }) {
  const paid = new Map(people.map((p) => [p.key, 0]));
  for (const e of expenses) paid.set(e.payerKey, paid.get(e.payerKey) + e.cents);
  return paid;
}

// What each person owes, in cents: every expense is shared by its sharers (everyone when it has no list), each getting
// floor(amount / N) and the remaining cents going one each to the first sharers alphabetically.
function expectedShares({ people, expenses }) {
  const everyone = people.map((p) => p.key);
  const shares = new Map(everyone.map((k) => [k, 0]));
  for (const e of expenses) {
    const sharers = [...(e.sharerKeys ?? everyone)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const n = sharers.length;
    if (n === 0) continue;
    const base = Math.floor(e.cents / n);
    const extra = e.cents % n;
    sharers.forEach((k, i) => shares.set(k, shares.get(k) + base + (i < extra ? 1 : 0)));
  }
  return shares;
}

// R2.2: the balances of everyone sum to exactly zero.
// R2.2: there is one row per person in the order of the file, each person's paid amount is what they paid, and each balance is
//       paid minus share.
// R2.1: each person's share is the one the expenses give, with the extra cents to the first names alphabetically.
export const balancesPostconditions = {
  computeBalances: [
    {
      criterion: 'R2.2',
      check(args, rows) {
        if (!Array.isArray(rows)) return 'the balances are not a list';
        const sum = rows.reduce((total, row) => total + row.balance, 0);
        return sum === 0 || `the balances add up to ${sum} cents, not zero`;
      },
    },
    {
      criterion: 'R2.2',
      check([parsed], rows) {
        const { people } = parsed;
        if (rows.length !== people.length) return `the balances have ${rows.length} rows for ${people.length} people`;
        const paid = expectedPaid(parsed);
        for (let i = 0; i < people.length; i++) {
          const row = rows[i];
          const person = people[i];
          if (row.name !== person.name) return `row ${i + 1} is for ${row.name}, but the person at that place in the file is ${person.name}`;
          if (row.paid !== paid.get(person.key)) return `${person.name} paid ${row.paid} cents in the balances, but the expenses say ${paid.get(person.key)} cents`;
          if (row.balance !== row.paid - row.share) return `${person.name} has a balance of ${row.balance} cents, but paid minus share is ${row.paid - row.share} cents`;
        }
        return true;
      },
    },
    {
      criterion: 'R2.1',
      check([parsed], rows) {
        const shares = expectedShares(parsed);
        for (let i = 0; i < parsed.people.length; i++) {
          const person = parsed.people[i];
          if (rows[i].share !== shares.get(person.key)) return `${person.name} has a share of ${rows[i].share} cents, but the expenses give ${shares.get(person.key)} cents`;
        }
        return true;
      },
    },
  ],
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

// The reports (Req 15.7). What the ledger prints is what a person reads, so the text and the JSON are checked against the
// balances and payments that the guarded computeBalances and settle returned. These checks write the amounts themselves
// instead of calling formatCents from src/money.js.

// Integer cents as a signed two-decimal string, for example -5.05.
function money(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// The same value, compared by content with object keys in any order.
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
}

// The lines of a report in the order renderText prints them: the header, one row per balance, then the payments, or one
// "All square." line when there are none.
function textLines(text) {
  return typeof text === 'string' ? text.split('\n') : null;
}

export const reportPostconditions = {
  // R4.1: the table has the header, then a row of paid, share and balance for each person, then one "<from> pays <to> <amount>"
  //       line per payment, with amounts written with two decimals.
  // R3.3: when there are no payments the report says "All square." and prints no payment line.
  renderText: [
    {
      criterion: 'R4.1',
      check([balances, payments], text) {
        const lines = textLines(text);
        if (lines === null) return 'the report is not text';
        const want = 1 + balances.length + Math.max(payments.length, 1);
        if (lines.length !== want) return `the report has ${lines.length} lines, but ${balances.length} balances and ${payments.length} payments need ${want}`;
        const header = lines[0].trim().split(/\s+/);
        if (header.join(' ') !== 'Name Paid Share Balance') return `the first line reads "${lines[0].trim()}" instead of the Name, Paid, Share and Balance header`;
        for (let i = 0; i < balances.length; i++) {
          const b = balances[i];
          const line = lines[1 + i].trimEnd();
          const amounts = [money(b.paid), money(b.share), money(b.balance)];
          const rest = line.startsWith(b.name) ? line.slice(b.name.length).trim().split(/\s+/) : null;
          if (rest === null || rest.join(' ') !== amounts.join(' ')) return `the row for ${b.name} reads "${line}" but should show ${amounts.join(', ')}`;
        }
        for (let i = 0; i < payments.length; i++) {
          const p = payments[i];
          const wanted = `${p.from} pays ${p.to} ${money(p.amount)}`;
          const got = lines[1 + balances.length + i].trimEnd();
          if (got !== wanted) return `payment line ${i + 1} reads "${got}" but should read "${wanted}"`;
        }
        return true;
      },
    },
    {
      criterion: 'R3.3',
      check([balances, payments], text) {
        const lines = textLines(text);
        if (lines === null) return 'the report is not text';
        const square = lines.some((l) => l.trim() === 'All square.');
        if (payments.length === 0) return square || 'there are no payments, so the report should say All square.';
        return !square || 'the report says All square. although there are payments';
      },
    },
  ],

  // R4.2: the JSON holds the balances and the payments as the guarded functions returned them, with amounts in integer cents.
  renderJson: {
    criterion: 'R4.2',
    check([balances, payments], text) {
      let printed;
      try {
        printed = JSON.parse(text);
      } catch {
        return 'the report is not JSON';
      }
      if (printed === null || typeof printed !== 'object') return 'the JSON report is not an object with balances and payments';
      if (!same(printed.balances, balances)) return 'the balances in the JSON report are not the balances computed';
      if (!same(printed.payments, payments)) return 'the payments in the JSON report are not the payments computed';
      return Object.keys(printed).length === 2 || 'the JSON report holds more than the balances and the payments';
    },
  },
};
