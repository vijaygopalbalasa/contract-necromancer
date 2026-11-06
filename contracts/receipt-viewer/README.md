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
- `clean.contract.test.js` and `look.contract.test.js` run `site/app.js` against a small fake DOM that each file carries
  as its own copy (a shared helper file would not be frozen). The fake DOM is built from the ids, tags, `hidden`
  attributes and static text in `site/index.html`, so it cannot drift from the page. The tests find elements by tag
  and button label (the textarea, the "show" and "sample" buttons, the text input, the `pre`), and use ids only to
  decide what is visible. They call `start({ document, location, fetch, navigator })`, the signature in `design.md`.
  `look.contract.test.js` also reads `site/index.html`, `site/style.css` and the site scripts as text.

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
| R7.1 | `clean.contract.test.js` | A task line with `**`, `__` and backticks is shown with the words intact and no marker anywhere in the visible text. |
| R7.2 | `clean.contract.test.js` | Eight passing contracts, listed out of order across `R1`, `R2` and `R10`, are shown in numeric order of requirement and of criterion (`R1.2` before `R1.10`, `R2.10` before `R10.1`). |
| R7.3 | `clean.contract.test.js` | With `task` and `required`, a passing contract that was not required says "not required for this task", a failing one says "not built yet", required ones get neither, and a receipt without `task` gets neither on any row. |
| R7.4 | `clean.contract.test.js` | After "Load the sample", the repository box is `vijaygopalbalasa/contract-necromancer` and the command clones `https://github.com/vijaygopalbalasa/contract-necromancer.git`; `README.md` contains `https://vijaygopalbalasa.github.io/contract-necromancer/`. |
| R8.1 | `look.contract.test.js` | "Risen" with the passing count when every required contract passes, "Still buried" with the failing required count otherwise, a receipt with no `task` counting every contract as required, and the verdict shown before the spec name, receipt hash and first contract. |
| R8.2 | `look.contract.test.js` | `index.html` has an inline `<svg>` with at least two shapes; no tag in it loads anything external except `<a>` links; `style.css` has no `@import`, `@font-face` or `url()` outside `data:` and `#`; every rule that sets a text color has AA contrast (4.5:1) on its own background, or on the page and card backgrounds. |
| R8.3 | `look.contract.test.js` | Every rule that starts an animation, or a transition on a moving property, is inside a `no-preference` block or is turned off by a `reduce` rule (the same selector, `*`, `*::before` or `*::after`); no SVG animation elements; script that animates mentions `prefers-reduced-motion`. |
| R8.4 | `look.contract.test.js` | Rows have the word PASS or FAIL, symbols are `aria-hidden`, and rows contain no image elements. Rules that reach only a failing row give it an arched top (`border-radius` with larger top corners than bottom, or `clip-path`); rules that reach only a passing row use `--alive` with a shadow, filter or animation and no arch; no `url()` and no generated text in those rules. |

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
| R7.1 | Other emphasis such as single `*`, which the criterion does not list. |
| R7.2 | Nothing the page shows is left unchecked. The test does not look at group headings, only at the order of the contracts. |
| R7.3 | Nothing the page shows is left unchecked. Matching ignores case, so `NOT BUILT YET` passes. |
| R7.4 | Only the sample flow is checked. A pasted receipt with an empty repository box still shows `OWNER/NAME`, as R5.1 requires, and the test reads the criterion that way. The deployed address is not fetched: the README text is the only thing checked. |
| R8.1 | Where the banner sits on screen. The test checks that it comes before the spec, hash and first contract in page order, which is reading order but not pixel position. The banner is found as the smallest visible element holding the verdict word and a number. |
| R8.2 | Whether the SVG looks like a gravestone with a checkmark, and whether it is visible. The test counts shapes. Contrast is computed from hex colors, so colors over a gradient, an image or a shadow, and text on a background set by a parent rule, are not measured; `color` values that are not hex or `var()` of a hex fail the test so they cannot hide. |
| R8.3 | That the browser applies the media query. The test reads the CSS and the scripts, it does not play an animation. A drifting fog layer is not required to exist: with no animation at all the test passes. |
| R8.4 | How the shape looks. The test accepts an arched `border-radius` or a `clip-path` as "a gravestone shape" and a shadow, filter or animation in `--alive` as "alive". It cannot see a gravestone drawn some other way and will fail it. Only rules whose selectors are class, tag or attribute selectors without `:hover`-style pseudo-classes are read. |

## Assumptions where `design.md` is silent

- `summarize` returns its contract list as an array of `{ name, result }` in any property. The test finds it by shape.
- `verifyCommand` returns the command as a string, or as an object with a `command` string.
- `style.css` has hex colors in `:root` tokens `--text --muted --alive --grave --accent --link --border`, and the page
  background is a hex color or a `var()` of one on `body`, `html` or `:root`. A `--surface`, `--card` or `--panel` token is
  also checked when present.

## Conflict with R2.2

R7.2 asks for contracts inside a requirement ordered by criterion number. The frozen `R2.2` contract in
`receipt.contract.test.js` asserts that `groupContracts` keeps receipt order inside a group (`R1.2`, `R1.10`, `R1.1`),
and `design.md` and task 4 say the same. Both cannot hold for `groupContracts`. The R7.2 test therefore checks the order
the page shows, not the output of `groupContracts`, so the two contracts agree as long as the sorting happens after
`groupContracts` (in `site/app.js` or a new function in `site/lib/`). `design.md` ("Order inside a group is receipt order")
should be updated to say so before task 15.

## Task order and the gate

Every test depends only on modules built in the first task that lists its criterion, so each task can tick when its own
criteria pass. Two exceptions:

- R6.2 needs `site/sample-receipt.json` (task 12) and the page code that names it (task 11). Do both pieces of work
  before ticking either task.
- Tasks 13 and 14 list no criteria, so the gate requires every contract for them.

- Task 15 lists R7.1 to R7.4 and task 16 lists R8.1 to R8.4. Their contracts are in `clean.contract.test.js` and
  `look.contract.test.js`. R7.4 also needs the README change, and R8.2 needs the SVG in `index.html`, so do those before
  ticking. `tasks.md` has not been updated to name the contract files for tasks 15 and 16.
- R8.3 passes today, because the only animation (the glow) is already inside a `no-preference` block. It guards later
  edits, such as adding the fog layer.

`tasks.md` plans several contract tests per criterion (for example R1.2 in `repo` and again in `app`). This draft has one
test per criterion and no `app.contract.test.js`. Only the contracts for R7 and R8 carry a fake DOM inside the contract
file; if the app-level checks for R1 to R6 should be frozen too, they need the same.
