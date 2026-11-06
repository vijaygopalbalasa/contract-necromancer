# Contracts for receipt-viewer

Draft contracts for `.kiro/specs/receipt-viewer/requirements.md`. They are expected to fail until the viewer is built.
A person reviews them and runs `necro freeze receipt-viewer`. After that, nobody edits them during a task.

Each test name starts with its criterion (`R3.1 `, with a space), because `requiredNames` in `src/lock.js` matches a
task's criteria to contract names with `n === 'R<c>' || n.startsWith('R<c> ')`.

## How the files are written

- Only `node:test` and `node:assert` are used for checks. `node:fs`, `node:os`, `node:path` and `node:crypto` are used
  to read files, build temp projects and hash. `src/` is imported to compare the viewer against the CLI (R3.2).
- Each viewer module is loaded with a dynamic `import()` inside the test. If `site/` is missing, each test fails
  and every contract name is still registered, so `necro freeze` records all names. A static import of a missing module
  would fail the whole file and record one failing contract named after the file.
- `src/receipts.js` pins only what `import` and `from` text points at. Dynamic imports are not followed, so each file
  names its viewer modules in a comment in the form `from '../../site/lib/x.js'`. This puts the viewer files in the
  receipt's `sources`. Keep those comments.
- There are no shared helper files. Anything a contract depends on that is not frozen could be edited during a task.
- Fetch is a stub in `files.contract.test.js`. Nothing touches the network.

## Contracts (one test per criterion)

| Criterion | File | What the test checks |
|---|---|---|
| R1.2 | `repo.contract.test.js` | `parseReceiptUrl` accepts a raw.githubusercontent.com link and returns `url` and `owner/name`; it refuses http, github.com blob links, look-alike hosts, credentials, `javascript:` and non-URLs. |
| R1.3 | `receipt.contract.test.js` | `parseReceipt` accepts a valid receipt unchanged and refuses 21 kinds of bad input without throwing, each with a one-line message that ends in a full stop, shows no engine error text, and names the field or problem. |
| R2.1 | `receipt.contract.test.js` | `summarize` returns spec, commit (null stays null), receipt hash, totals, and every contract once, in order, with its result, including a repeated name in another file. |
| R2.2 | `receipt.contract.test.js` | `groupContracts` groups `R<n>.<m>` names by number, orders groups numerically, puts other names last in "Other", and returns one flat "Contracts" group when no name has a number. |
| R3.1 | `canon.contract.test.js` | `computeReceiptHash` equals the SHA-256 of the expected canonical JSON, ignores top-level `receiptHash` and `createdAt` only, calls `crypto.subtle.digest` with SHA-256, and `canon.js` has no `node:` import. |
| R3.2 | `canon.contract.test.js` | The page's `canonicalJson`, `sha256Hex` and `computeReceiptHash` equal `src/canon.js` and `src/receipts.js` on a corpus, on a receipt built by the real `buildReceipt`, and on pretty-printed and minified copies. |
| R4.1 | `files.contract.test.js` | `checkFiles` requests each pinned file once at `raw.githubusercontent.com/<repo>/<commit>/<path>`, hashes raw bytes (CRLF, non-UTF-8), and marks `match` or `different`. A 404 or network error is `unavailable`, never `different`. |
| R4.2 | `files.contract.test.js` | With `gitCommit` null or missing, `checkFiles` returns `ok: false` with a message that the file check needs a commit, and makes no request. |
| R4.3 | `files.contract.test.js` | A path in `uncommitted` gets status `uncommitted`, is not requested, sets `anyUncommitted`, and the other files are still checked. |
| R5.1 | `repo.contract.test.js` | `verifyCommand` gives one line with `git clone https://github.com/<repo>.git`, then `git checkout <commit>`, then `necro verify .necro/receipts/<spec>/<hash>.json`; an empty repository gives `OWNER/NAME`. |
| R6.1 | `style.contract.test.js` | `index.html` has the viewport meta tag. `style.css` has a dark background and light text, AA contrast for the color tokens, separate rules using `--alive` and `--grave`, `overflow-wrap: anywhere`, wrapping `pre`, and no fixed width above 320 px outside `@media`. |
| R6.2 | `sample.contract.test.js` | `site/sample-receipt.json` parses, its stored hash equals the recomputed hash, its spec and requirements path exist in this repository, its contracts are under `contracts/<spec>/`, and `site/app.js` or `site/index.html` names the file. |

## Criteria with no contract

These cannot be checked in Node with the modules in `design.md`, because they need a rendered page. `design.md` calls for a
fake DOM in `test/`; that test is not frozen and does not gate a task.

| Criterion | Reason |
|---|---|
| R1.1 | Paste and file pick show the receipt. The behavior is DOM events and rendering in `site/app.js`. `parseReceipt` is covered by R1.3. |
| R2.3 | The task line, "required" and "not yet required" marks, and the "not built yet" wording are display only. `design.md` names no module or function for them, and no task in `tasks.md` lists 2.3, so the gate never asks for it. |

## Contracts that cover only part of the criterion

The rest of each criterion is page behavior (DOM, clipboard, layout) that Node cannot check.

| Criterion | Not checked |
|---|---|
| R1.2 | That the page fetches the link and shows the receipt. Only the decision about which links are accepted is checked. |
| R1.3 | That the message appears in the `role="alert"` element. |
| R2.1 | That the page renders the summary. |
| R2.2 | That the page renders one section per group. |
| R3.1 | That the page shows MATCH or ALTERED. The hash that decides it is checked. |
| R4.2 | That the page displays the message. |
| R4.3 | That the page shows the "commit the work and re-run the gate" notice. |
| R5.1 | That the command is displayed and the copy button works. Only the command text is checked. |
| R6.1 | Real layout at phone width (no horizontal scrolling), the PASS and FAIL words and glyphs. CSS is checked statically. The manual check in task 14 covers layout. |
| R6.2 | That the "Load the sample" button fetches and renders the file. The test checks the file and that the page code names it. |

## Assumptions where `design.md` is silent

- `summarize` returns its contract list as an array of `{ name, result }` in any property. The test finds it by shape.
- `verifyCommand` returns the command as a string, or as an object with a `command` string.
- `style.css` has hex colors in `:root` tokens `--text --muted --alive --grave --accent --link --border`, and the page
  background is a hex color or a `var()` of one on `body`, `html` or `:root`. A `--surface`, `--card` or `--panel` token is
  also checked when present.

## Task order and the gate

Every test depends only on modules built in the first task that lists its criterion, so each task can tick when its own
criteria pass. Two exceptions:

- R6.2 needs `site/sample-receipt.json` (task 12) and the page code that names it (task 11). Do both pieces of work
  before ticking either task.
- Tasks 13 and 14 list no criteria, so the gate requires every contract for them.

`tasks.md` plans several contract tests per criterion (for example R1.2 in `repo` and again in `app`). This draft has one
test per criterion and no `app.contract.test.js`. If the app-level checks should be frozen, they need the fake DOM from
`design.md` inside the contract file.
