# Tasks: ledger

Each task writes its tests first, confirms they fail, then adds the code that makes them pass. Run tests with `npm test`.

- [ ] 1. Amount parsing and formatting (Req 1.1, 1.4)
  - Write `test/money.test.js`: `12`, `12.5`, `12.50`, `0.05` parse to 1200, 1250, 1250, 5; `0`, `0.00`, `-3`, `1.234`, `abc`, `12.`, `.5` throw `LedgerError` with the messages in the design; `formatCents` gives `12.50`, `0.05`, `-5.05`.
  - Add `src/errors.js` and `src/money.js` using string handling only, no floating point.

- [ ] 2. Parse expense lines (Req 1.1, 1.4, 1.5)
  - Write `test/parse.test.js` for lines without `split`: payer, cents and `what` are recorded; empty lines and `#` lines are skipped; an unreadable line, a zero amount and a three-decimal amount each throw an error that starts with the right `Line <n>:`, counting skipped lines.
  - Add `src/parse.js` with `parseLedger` for the `<payer> paid <amount> for <what>` form.

- [ ] 3. Split lists and person identity (Req 1.2, 1.3)
  - Extend `test/parse.test.js`: `split a,b` sets `sharerKeys`; no `split` leaves `null`; a `what` containing the word "split" still parses; an empty entry such as `a,,b` throws with its line number; `Ann`, `ann` and ` ANN ` are one person shown as the first spelling; a name seen only in a split list is added to `people`; repeated names in one split count once.
  - Extend `src/parse.js` with the split clause and the people registry.

- [ ] 4. Split one expense to the cent (Req 2.1)
  - Write `test/split.test.js`: 100 cents over 3 gives 34, 33, 33 to the first, second and third names alphabetically; 1 cent over 7 goes to the first name only; exact divisions give equal shares; sorting ignores letter case; shares always sum to the amount over a list of awkward inputs.
  - Add `src/split.js` with `splitExpense` using integer division and code-unit key order.

- [ ] 5. Compute balances (Req 1.2, 2.2)
  - Write `test/balances.test.js`: paid, share and balance per person for a small party; an expense without `split` is shared by everyone in the file, including people named only on later lines; a payer outside the split list is credited in full; balances sum to exactly zero for several fixtures.
  - Add `src/balances.js` with `computeBalances`.

- [ ] 6. Settle balances (Req 3.1, 3.2, 3.3)
  - Write `test/settle.test.js`: a known case with the exact expected payment list; ties for largest creditor and debtor go to the smaller name, ignoring case; every payment is a positive integer; applying all payments zeroes every balance; the same input gives the same output on repeated runs; all-zero balances give `[]`.
  - Add `src/settle.js` with the greedy largest-debtor to largest-creditor rule.

- [ ] 7. Text and JSON reports (Req 4.1, 4.2, 3.3)
  - Write `test/report.test.js`: the table has the columns name, paid, share, balance with two-decimal amounts; payments print as `<from> pays <to> <amount>`; no payments prints `All square.` and no payment lines; `renderJson` output parses to `{balances, payments}` with integer cents and `payments: []` when square.
  - Add `src/report.js` with `renderText` and `renderJson`.

- [ ] 8. Command line (Req 4.1, 4.2, 4.3, 1.4)
  - Write `test/cli.test.js` using `spawnSync` on temporary files: `ledger <file>` prints the table and payments and exits 0; `--json` prints parseable JSON; a missing file exits 1 with one sentence on stderr; a file with a bad line exits 1 with the `Line <n>:` sentence; a missing argument exits 1 with the usage sentence.
  - Add `bin/ledger.js`, which only parses arguments, reads the file, calls `src/`, and prints. Run the full `npm test` suite.
