# Design: ledger

## Overview
Pumpkin Ledger is a pipeline of small pure functions. `bin/ledger.js` reads the file, calls the pipeline, and prints. Nothing else touches the file system or the console.

```
text --parseLedger--> { people, expenses } --computeBalances--> balances --settle--> payments
                                                    \______________________________/
                                                                   |
                                                    renderText / renderJson --> string
```

Constraints from steering: Node 24+, ES modules, built-ins only, tests under `test/` run with `node --test`, money is integer cents with no floating point, user-facing errors are one short plain sentence.

## Files

| File | Responsibility |
|---|---|
| `src/errors.js` | `LedgerError`, the only error type shown to users. |
| `src/money.js` | `parseAmount(text)` returns integer cents. `formatCents(cents)` returns `"12.50"`. |
| `src/parse.js` | `parseLedger(text)` returns `{ people, expenses }`. |
| `src/split.js` | `splitExpense(cents, sharerKeys)` returns the cents each sharer owes. |
| `src/balances.js` | `computeBalances({ people, expenses })` returns one row per person. |
| `src/settle.js` | `settle(balances)` returns the list of payments. |
| `src/report.js` | `renderText(balances, payments)` and `renderJson(balances, payments)`. |
| `bin/ledger.js` | Parses `<file> [--json]`, reads the file, prints, sets the exit code. |
| `test/*.test.js` | One test file per `src/` file, plus `cli.test.js` that runs the binary. |

## Data shapes

All amounts are integer cents.

- **Person key:** `name.trim().toLowerCase()`. Two names are the same person when their keys match.
- **Person:** `{ key, name }`. `name` is the spelling from the person's first appearance.
- **Expense:** `{ payerKey, cents, what, sharerKeys }`. `sharerKeys` is `null` when the line has no `split`, meaning everyone.
- **`people`:** array of persons in order of first appearance. Within a line the payer comes first, then the split names left to right.
- **Balance row:** `{ name, paid, share, balance }`. Rows follow the order of `people`.
- **Payment:** `{ from, to, amount }`, using display names.

## Components

### Errors (`src/errors.js`)
`LedgerError extends Error`. The message is the sentence shown to the user. `parseLedger` prefixes line errors with `Line <n>: `. No other error type is caught by the binary; anything else is a bug and surfaces as a stack trace.

### Money (`src/money.js`)
`parseAmount` works on the text, never through `Number` arithmetic on decimals.

1. Accept `^\d+(\.\d{1,2})?$`.
2. cents = `whole * 100 + fraction`, where `fraction` is the decimal digits right-padded to two digits (`"5"` becomes 50).
3. Reject with a `LedgerError` otherwise. The message depends on why: a leading `-` gives "Amount must be more than zero.", more than two decimals gives "Amount can have at most two decimals.", anything else gives "Amount is not a number like 12 or 12.50."
4. Reject a result of 0 with "Amount must be more than zero." Reject results that are not safe integers with "Amount is too large."

`formatCents(c)` returns the sign, `Math.trunc(abs/100)`, a dot, and the two-digit remainder, for example `-5.05`. Used for the text report only.

### Parser (`src/parse.js`)
Processes the text line by line with 1-based line numbers. Splits on `\r?\n`.

1. Trim the line. If it is empty or starts with `#`, skip it (Req 1.5).
2. Match `^(.+?)\s+paid\s+(\S+)\s+for\s+(.+)$`. No match gives "Line n: Write the line as '<payer> paid <amount> for <what>'." The keywords `paid`, `for` and `split` are lowercase and case-sensitive.
3. Parse the amount with `parseAmount`. Prefix its error with the line number.
4. On the remainder after `for`, look for the last occurrence of `\s+split\s+`. If found, the text before it is `what` and the text after it is the name list. This lets `what` contain the word "split" earlier in the text.
5. Split the name list on `,`, trim each, and reject any empty entry with "Line n: Split needs names separated by commas." Names are deduplicated by key so nobody is charged twice on one expense.
6. Register the payer and each split name in `people` (first spelling wins).
7. An expense without `split` keeps `sharerKeys: null`. `computeBalances` expands it to every key in `people` once the whole file is read, so names that first appear on later lines are included (Req 1.2).

A file with no expense lines yields empty `people` and `expenses`, which settles to "All square.".

### Splitting (`src/split.js`)
`splitExpense(cents, sharerKeys)`:

1. Sort a copy of `sharerKeys` with plain code-unit comparison (`a < b`), not `localeCompare`, so the order does not depend on the machine's locale.
2. `base = Math.floor(cents / N)`, `extra = cents % N`.
3. The first `extra` keys in sorted order get `base + 1`, the rest get `base`.

Integer division on safe integers is exact, so no floating point error enters. The result is a `Map` from key to cents, and its values sum to `cents`.

### Balances (`src/balances.js`)
For each expense, add `cents` to the payer's `paid`, and add each `splitExpense` share to that person's `share`. `balance = paid - share`. Because every expense's shares sum to its amount, the balances sum to exactly zero (Req 2.2). A payer who is not among the sharers still gets credit for what they paid.

### Settling (`src/settle.js`)
Greedy, as required by Req 3.2:

1. Take the balances as mutable `{ key, name, balance }` entries.
2. Loop: pick the creditor with the largest positive balance and the debtor with the most negative balance. Ties go to the smaller key (code-unit order).
3. Stop when there is no debtor. Otherwise emit `{ from: debtor.name, to: creditor.name, amount: min(creditor.balance, -debtor.balance) }` and apply it to both.
4. Each pass zeroes at least one person, so the loop ends in at most N-1 passes. Every amount is a positive integer.

Input that does not sum to zero is a programming error, so `settle` throws a plain `Error`, not a `LedgerError`.

Note on the product goal "in the fewest payments": the greedy rule fixed by Req 3.2 gives at most N-1 payments and is deterministic, but it is not guaranteed to be the global minimum in every case. Requirements are final, so the design follows Req 3.2.

### Report (`src/report.js`)
- `renderText`: a table with the columns `Name`, `Paid`, `Share`, `Balance`, amounts through `formatCents`. Names are left-aligned and amounts right-aligned, padded to the widest cell. Then one line per payment, `<from> pays <to> <amount>`. When `payments` is empty, print `All square.` instead of payment lines (Req 3.3).
- `renderJson`: `JSON.stringify({ balances, payments })` with balance rows `{name, paid, share, balance}` and payments `{from, to, amount}`, all in integer cents. Always includes both keys, with `payments: []` when square.

### Binary (`bin/ledger.js`)
1. Arguments: exactly one file path, plus optional `--json` in any position. Anything else prints "Usage: ledger <file> [--json]" to stderr and exits 1. (Assumption: the requirements do not define the usage error.)
2. Read the file with `fs.readFileSync(path, 'utf8')`. Any failure prints "Cannot read <file>." to stderr and exits 1 (Req 4.3).
3. Run `parseLedger`, `computeBalances`, `settle`, then print `renderJson` or `renderText` to stdout.
4. A `LedgerError` prints its message to stderr and exits 1. This covers line errors from Req 1.4.

## Error messages
Each is one sentence naming what to fix.

| Cause | Message |
|---|---|
| Unreadable line | `Line 3: Write the line as '<payer> paid <amount> for <what>'.` |
| Zero or negative amount | `Line 3: Amount must be more than zero.` |
| Three or more decimals | `Line 3: Amount can have at most two decimals.` |
| Not a number | `Line 3: Amount is not a number like 12 or 12.50.` |
| Empty split entry | `Line 3: Split needs names separated by commas.` |
| Missing file | `Cannot read <file>.` |

## Testing strategy
Tests use `node:test` and `node:assert/strict`. Each pure module has table-driven unit tests. Two properties are checked over a fixed list of inputs, including awkward remainders (for example 100 cents over 3, 1 cent over 7, and a payer who is not a sharer):

- Shares of one expense sum to its amount.
- Balances sum to zero, and applying the payments brings every balance to zero.

`cli.test.js` runs `bin/ledger.js` with `child_process.spawnSync` on temporary files and checks stdout, stderr and exit codes.

## Requirement coverage

| Req | Where |
|---|---|
| 1.1 | `money.js`, `parse.js` |
| 1.2 | `parse.js`, `balances.js` |
| 1.3 | person keys in `parse.js` |
| 1.4 | `money.js`, `parse.js`, `bin/ledger.js` |
| 1.5 | `parse.js` |
| 2.1 | `split.js` |
| 2.2 | `balances.js` |
| 3.1, 3.2 | `settle.js` |
| 3.3 | `settle.js`, `report.js` |
| 4.1, 4.2 | `report.js`, `bin/ledger.js` |
| 4.3 | `bin/ledger.js` |
