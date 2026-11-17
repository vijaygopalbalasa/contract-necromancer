# Design: receipt-viewer

## Overview

A static page in `site/` that opens a Contract Necromancer receipt, lists each contract with pass or fail, recomputes the
receipt hash in the browser, optionally hashes the pinned files from a public GitHub repository, and shows the command to
re-run the receipt locally. There is no server, no build step, and no dependency. Everything the page knows comes from
the receipt, the repository the user names, and `raw.githubusercontent.com`.

Honest limit, shown on the page: the browser checks hashes, not test runs. Contracts re-run in Node with `necro verify`.

Decisions that shape the rest of this document:

- **The browser hash code is a separate pure module, not an import of `src/canon.js`.** `src/canon.js` imports
  `node:crypto` and `node:fs`, so a browser cannot load it. `site/lib/canon.js` re-implements `canonicalJson` with the same
  algorithm and uses Web Crypto for SHA-256. Parity is enforced by tests that run both implementations on the same inputs
  (see "Hash parity"). `src/` is not touched.
- **Logic lives in small pure modules under `site/lib/`; the DOM code is thin.** The pure modules run unchanged under
  `node --test`. The DOM code takes its environment (document, location, fetch, clipboard) as arguments so tests drive it
  with a small fake DOM.
- **Nothing is fetched until the user asks**, except the one URL in `?receipt=` that the visitor chose to open.

## Architecture

```
site/index.html ── <script type="module" src="main.js">
                          │
                      site/main.js         start({ document, location, fetch, navigator })
                          │
                      site/app.js          DOM wiring: inputs, rendering, events
                          │
        ┌─────────────┬───┴─────────┬──────────────┐
        ▼             ▼             ▼              ▼
  lib/receipt.js   lib/repo.js   lib/files.js   lib/canon.js
  parse, group,    URL + repo    hash pinned    canonicalJson,
  summarize        parsing,      files from     sha256Hex,
                   run command   GitHub         computeReceiptHash
                                    │               ▲
                                    └───────────────┘

site/style.css          dark theme, alive / gravestone styling
site/sample-receipt.json   a real receipt from this repository
```

Dependency rules: `canon.js` imports nothing. `receipt.js` and `repo.js` import nothing. `files.js` imports `canon.js`
and `repo.js`. `app.js` imports the four lib modules. No file in `site/` imports a `node:` module or a bare specifier,
because the browser could not resolve either. A test checks this.

## Modules

| Module | Path | Responsibility | Exports |
|---|---|---|---|
| Canonical JSON and hash | `site/lib/canon.js` | Same canonical JSON and receipt hash as the CLI (Req 3). | `canonicalJson(value)`, `sha256Hex(textOrBytes)` → `Promise<string>`, `computeReceiptHash(receipt)` → `Promise<string>` |
| Receipt model | `site/lib/receipt.js` | Parse and validate input, group contracts, list pinned files (Req 1.3, 2, 4). | `parseReceipt(text)`, `summarize(receipt)`, `groupContracts(contracts)`, `pinnedFiles(receipt)`, `MAX_RECEIPT_BYTES` |
| Repository and URLs | `site/lib/repo.js` | Validate user and URL input, build raw URLs, build the run command (Req 1.2, 4.1, 5.1). | `parseRepo(input)`, `parseReceiptUrl(search)`, `isCommitId(s)`, `isSafeRepoPath(p)`, `rawUrl(repo, commit, path)`, `verifyCommand({ repo, receipt })` |
| File check | `site/lib/files.js` | Fetch and hash pinned files, classify each (Req 4). | `checkFiles({ receipt, repo, fetchFn, concurrency })` |
| App | `site/app.js` | Build DOM, handle paste, file pick, query string, buttons. | `start(env)` |
| Entry | `site/main.js` | Call `start` with the real browser globals. | none |

Every `site/lib/*.js` and `site/app.js` has a test file in `test/` named `site-<module>.test.js`, so the existing
`node --test test/*.test.js` script runs them. Fixtures go in `test/fixtures/`, including a small fake DOM.

### lib/canon.js

```js
function sortKeys(value) { /* identical to src/canon.js */ }
export function canonicalJson(value) { return JSON.stringify(sortKeys(value)); }

export async function sha256Hex(textOrBytes) {
  const bytes = typeof textOrBytes === 'string' ? new TextEncoder().encode(textOrBytes) : textOrBytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computeReceiptHash(receipt) {
  const { receiptHash: _rh, createdAt: _ca, ...rest } = receipt;   // top level only, as in src/receipts.js
  return sha256Hex(canonicalJson(rest));
}
```

`globalThis.crypto.subtle` exists in the browser (secure context: GitHub Pages is https, `localhost` also counts) and in
Node 24, so tests exercise the same code path the page runs.

### lib/receipt.js

`parseReceipt(text)` returns `{ ok: true, receipt }` or `{ ok: false, message }`. Validation is structural only, enough to
render safely. It never judges whether the receipt is correct; a receipt with edited fields must still render so the page
can show ALTERED.

Required: top-level object; `spec` string; `receiptHash` 64 lowercase hex; `requirements` with string `path` and 64-hex
`sha256`; `contracts` non-empty array of `{ name: string, path: string, sha256: 64-hex, result: 'pass' | 'fail' }`.
Optional: `gitCommit` string or null; `sources` array of `{ path, sha256 }`; `uncommitted` array of strings; `createdAt`
string. Unknown extra fields are kept, because they are part of the hash.

Messages are one plain sentence that says what to do next. Examples:

- `This is not valid JSON. Paste the contents of a file from .necro/receipts/.`
- `This JSON is not a receipt: "contracts" is missing. Paste a file from .necro/receipts/.`
- `This receipt is larger than 1 MB. Open a receipt file written by necro.`

The page hashes the **parsed object**, never the raw text, so whitespace and key order in the pasted text do not matter.

`groupContracts(contracts)` reads `/^R(\d+)\.\d+/` from each name. It returns
`[{ requirement: 1, title: 'Requirement 1', contracts, passed, total }, ..., { requirement: null, title: 'Other', ... }]`,
groups ordered by number, "Other" last and only when needed. Order inside a group is receipt order. When no name matches,
the result is one flat "Contracts" group so the page does not show a lone "Other".

`pinnedFiles(receipt)` returns `[{ kind: 'requirements' | 'contract' | 'source', path, sha256 }]`, deduplicated by the pair
(path, sha256). Many contracts share one file, and one row per file is what a reviewer wants. If the same path appears with
two different hashes, both rows stay, and at most one can match.

### lib/repo.js

- `parseRepo(input)` accepts `owner/name`, and also `https://github.com/owner/name`, with an optional `.git` or trailing
  slash. It returns `{ ok: true, repo: 'owner/name' }` or `{ ok: false, message }`. Owner and name must match
  `/^[A-Za-z0-9_.-]+$/` and not be `.` or `..`.
- `parseReceiptUrl(search)` reads `receipt` from the query string. `null` when absent. Accepts only `https:` URLs whose
  host is exactly `raw.githubusercontent.com`, with a path of `/<owner>/<name>/<ref>/<path...>`. Returns
  `{ ok: true, url, repo }` (the `owner/name` is used to prefill the repository box) or `{ ok: false, message }`, for
  example `Only raw.githubusercontent.com links work. Use the Raw button on GitHub and paste that link.`
- `isCommitId(s)`: 40 lowercase hex characters.
- `isSafeRepoPath(p)`: not empty, no leading `/`, no backslash, no `.` or `..` segment, no empty segment, no control
  characters. Receipt paths are untrusted input.
- `rawUrl(repo, commit, path)`: `https://raw.githubusercontent.com/<owner>/<name>/<commit>/<path>` with each path segment
  passed through `encodeURIComponent`. Returns `null` when any input is invalid.
- `verifyCommand({ repo, receipt })`: see "Run command".

### lib/files.js

```js
checkFiles({ receipt, repo, fetchFn = fetch, concurrency = 6 })
  → Promise<
      { ok: false, message }                      // no usable commit
    | { ok: true, files: FileResult[], anyUncommitted: boolean } >

FileResult = { kind, path, expected, status, actual?, detail? }
status ∈ 'match' | 'different' | 'uncommitted' | 'unavailable'
```

Per pinned file, in this order:

1. No usable `gitCommit` (null, missing, or not 40-hex): return `{ ok: false, message }` before any request. A missing
   commit says `The file check needs a git commit, and this receipt has none. Run the gate inside a git repository to get one.`
   (Req 4.2). A malformed one says the commit is not a valid commit id.
2. Path is in `receipt.uncommitted`: status `uncommitted`, **no request** (Req 4.3). The file is not in the commit, so
   fetching it would prove nothing.
3. `!isSafeRepoPath(path)`: status `unavailable`, detail `The path in the receipt is not safe to fetch.`
4. Fetch `rawUrl(...)` with `{ credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) }`.
   HTTP error: `unavailable` with the status code and `Check the repository name and that it is public.` Network error:
   `unavailable` with `Could not reach raw.githubusercontent.com.`
5. Hash the **raw bytes** (`arrayBuffer()`, never `text()`), compare with `expected`. Equal: `match`. Otherwise
   `different`, with `actual` set.

Four statuses, not three, because "I could not look" is different from "I looked and it differs". Showing a network error
as `different` would accuse the author of something the page does not know.

Concurrency is bounded (default 6) so a receipt with many sources does not open dozens of connections.

Known limit, shown in the file-check help text: raw.githubusercontent.com serves the stored blob. A file kept in Git LFS
comes back as a pointer file and shows as `different`.

### Run command (Req 5.1)

```
git clone https://github.com/OWNER/NAME.git necro-check && cd necro-check && git checkout <gitCommit> && necro verify .necro/receipts/<spec>/<receiptHash>.json
```

- `OWNER/NAME` is the repository box content, or the literal `OWNER/NAME` while the box is empty or invalid. The command is
  always shown and updates as the box changes. The placeholder uses no angle brackets, because `<` is shell redirection.
- When `gitCommit` is missing or invalid, the `git checkout` step is dropped and a note says the receipt names no commit.
- Every interpolated value goes through `shQuote`: left bare when it matches `/^[A-Za-z0-9_./:@%+=-]+$/`, otherwise wrapped
  in single quotes with `'` written as `'\''`. Receipt fields are untrusted, so a `spec` such as `x; rm -rf ~` becomes
  one inert argument. The commit must pass `isCommitId` to be used at all.
- The receipt path is `.necro/receipts/<spec>/<receiptHash>.json`, where `necro` writes receipts. If a team keeps receipts
  elsewhere, the path is wrong; the page says the command assumes the default location.
- The command assumes `necro` is on the PATH, as in the README. The page links to the project README instead of hard-coding
  an install method.
- The copy button calls `navigator.clipboard.writeText`. If that rejects, the page tells the user to select the text
  (the command sits in a selectable `<pre>`).

## Data flow

**Open (Req 1).** Three entry points feed one function, `showReceipt(text)`:

1. Paste: a textarea and a Show button.
2. File pick: `<input type="file" accept=".json,application/json">`, read with `file.text()`; files over 1 MB are rejected
   before reading.
3. Query: on load, `parseReceiptUrl(location.search)`. If valid, `fetch(url, { credentials: 'omit',
   referrerPolicy: 'no-referrer', signal })` and pass the body to `showReceipt`. If invalid, show the message in the same
   error area as Req 1.3. The repository box is prefilled from the URL.

`showReceipt` calls `parseReceipt`. On `ok: false` it writes the message to a `role="alert"` element and leaves the
previous receipt cleared. On success it renders, then starts the hash check.

**Show (Req 2, 3, 5).** Header: spec name, git commit (or "none"), receipt hash, `createdAt` when present. Summary line:
`N of M contracts pass`. Then one section per group from `groupContracts`, each contract as a list row with a state
marker and the words PASS or FAIL. Then the hash check, then the run command, then the file-check form.

**Hash check (Req 3).** `computeReceiptHash(receipt)` runs on the parsed object. Equal to `receipt.receiptHash`: show
`MATCH`. Otherwise show `ALTERED`, with the expected and computed values. While it runs the badge reads `checking`.
Web Crypto missing (insecure context): show `Cannot check: this page needs https or localhost.` instead of a verdict.

**File check (Req 4).** The user types a repository and presses Check files. `parseRepo` first; an error stays in the form.
Then `checkFiles`. Rows render as a table-like list: path, kind, status word, detail. If `anyUncommitted`, a notice appears
above the list: `Some files are not in the commit yet. Commit the work and re-run the gate for a fully public check.`
A summary line counts statuses (`3 match, 0 different, 2 not in the commit yet, 0 could not be checked`).

## Security

The page renders data that came from strangers (receipt JSON, file paths, contract names), so:

- **No HTML injection.** `app.js` builds DOM with `createElement` and `textContent` only. No `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`. A test scans `site/app.js` and `site/lib/*.js` for
  these.
- **Content-Security-Policy meta tag** in `index.html`:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'`.
  This forbids inline script and inline style, so the HTML has none, and the JS never uses `setAttribute('style', ...)`.
- **Fetch allow-list.** Only `raw.githubusercontent.com` over https, plus same-origin `sample-receipt.json`. The `?receipt=`
  URL is parsed with `new URL` and the host compared for equality, not with a substring test, so
  `raw.githubusercontent.com.evil.example` is refused.
- **Path and commit validation** before any URL is built (`isSafeRepoPath`, `isCommitId`), and `encodeURIComponent` on every
  path segment.
- **Quoting** for the copyable shell command, described above.
- **Size and time limits:** 1 MB for a receipt, 15 s per request.
- **No credentials, no cookies, no referrer** on outgoing requests. The page stores nothing.

## Hash parity (Req 3.1, 3.2)

The browser hash must equal `computeReceiptHash` in `src/receipts.js`, which is `sha256(canonicalJson(receipt without
receiptHash and createdAt))`. To keep that true:

- `sortKeys` is copied from `src/canon.js` line for line, quirks included, instead of being "improved". Both sort with the
  default `Array.prototype.sort` (UTF-16 code units), and both finish with `JSON.stringify`, so escapes, number formatting,
  and non-ASCII output match.
- SHA-256 input is UTF-8 bytes (`TextEncoder` in the browser, `Buffer.from(..., 'utf8')` in the CLI).
- Hash input is the parsed object, so the page and `necro verify` (which also hashes the parsed object) agree even when the
  file's whitespace differs.
- Tests compare the two implementations directly: a corpus of values (nested objects, arrays of objects, empty objects,
  unicode keys, astral characters, escapes, mixed-case and numeric-looking keys), a golden receipt hash computed by the CLI
  and stored in a fixture, and a receipt built by the real `buildReceipt` in a temp project and confirmed by the real
  `verify`. Any drift fails a test.

## Visual design (Req 6.1)

Dark theme. All colors are CSS custom properties in `:root`. Contrast ratios were computed against the page background
`#0e0b14` and the card surface `#1a1426`; WCAG AA needs 4.5 for body text and 3 for large text and UI boundaries.

| Token | Value | On bg | On surface | Use |
|---|---|---|---|---|
| `--text` | `#ece8f5` | 16.2 | 14.9 | body text |
| `--muted` | `#b9b0cf` | 9.5 | 8.7 | secondary text |
| `--alive` | `#7dffb3` | 15.6 | 14.4 | passing contract text and glow |
| `--grave` | `#ff9a9a` | 9.6 | 8.8 | failing contract text, ALTERED |
| `--accent` | `#ffa94d` | 10.3 | 9.4 | headings, focus ring, buttons |
| `--link` | `#8ecbff` | 11.3 | 10.4 | links |
| `--border` | `#6f6588` | 3.6 | 3.3 | input and card borders (UI, needs 3) |
| button text `#14101c` on `--accent` | | 9.9 | | button label |

A test parses `style.css`, resolves these tokens, and asserts each pair meets its threshold, so a later edit that lowers
contrast fails.

- **Alive vs gravestone.** A passing contract row shows a glowing sprout or flame glyph and the word `PASS` in `--alive`. A
  failing row shows a tombstone glyph (`🪦`-style, drawn with CSS or an inline-free text glyph) and the word `FAIL` in
  `--grave`, with a heavier left border. State is never carried by color alone: the word and the glyph shape differ.
  Glyphs are `aria-hidden`; the word is the accessible text.
- **Phone width.** Single column, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `min-width: 0` on
  grid and flex children, `overflow-wrap: anywhere` on hashes, paths and the command (long unbroken strings are the usual
  cause of sideways scroll), `max-width: 100%` on `pre` with wrapping on. Checked by hand at 320 px.
- **Motion.** Glow animation only inside `@media (prefers-reduced-motion: no-preference)`.
- **Keyboard and screen readers.** Real `<button>`, `<label>`, and `<textarea>` elements; visible focus ring in
  `--accent`; `role="alert"` for errors; `aria-live="polite"` for the hash and file-check results.

Theme is Kiroween (Halloween) in the glyphs, the heading text and the sample, and nowhere in the facts.

## Hosting

GitHub Pages serves `site/` through a GitHub Actions workflow (`.github/workflows/pages.yml`) that uploads `site/` as the
Pages artifact with `actions/upload-pages-artifact` and deploys with `actions/deploy-pages`. There is no build step. The
repository owner must set Settings → Pages → Source to "GitHub Actions" once; that cannot be done from the repository.

`site/` must be self-contained, because Pages publishes only that folder. Hence `site/sample-receipt.json` is a copy of a
real receipt, not a link into `.necro/`.

The page uses ES modules, which browsers refuse to load from `file://`. To try it locally: `node --test` for logic, and for
the page `python3 -m http.server -d site` (the README line says so; the page itself needs no Python).

## Sample receipt (Req 6.2)

`site/sample-receipt.json` is a byte copy of a receipt written by `necro` in this repository, not hand-edited. A hand-made
one would show the wrong thing to the first visitor. A "Load the sample" button fetches it from the same origin and calls
`showReceipt`, and prefills the repository box with the constant `SAMPLE_REPO` in `app.js`.

For the sample's file check to say `match`, the receipt must have `uncommitted: []`, which requires the work to be
committed and pushed before the gate that writes it. If it was written with uncommitted files, it still works and shows the
Req 4.3 state.

A test checks that the sample parses, that its recomputed hash equals its `receiptHash`, and that it is not edited.

## Testing

- `node --test` runs everything. Pure modules get direct unit tests; `app.js` gets tests with `test/fixtures/fake-dom.js`
  (about 80 lines: elements with `textContent`, `children`, `value`, `hidden`, `classList`, `addEventListener`, `dispatch`,
  `getElementById`).
- Fetch is always injected, so no test touches the network. Tests build `Response` objects (global in Node 24).
- Static tests read `site/` as text: no `node:` or bare imports in `site/`, no HTML sinks, CSP present, no inline
  `<script>` or `style=`, viewport meta present, the "browser checks hashes, not test runs" sentence present, contrast table
  holds.

What node tests cannot prove: real layout at phone width (Req 6.1) and real clipboard behavior. Those are covered by static
CSS checks and a manual checklist in the last task. The tasks say so instead of claiming otherwise.

## Contracts and the gate

The gate runs every frozen contract of a spec on every task tick, and refuses to tick when the spec is not frozen. So each
task adds its own contract file `contracts/receipt-viewer/<module>.contract.test.js`, one test per acceptance criterion
named like `R3.2 page and CLI compute the same receipt hash`, and a person re-freezes with `necro freeze receipt-viewer`
before the agent ticks that task. Contract names start with the requirement number so the viewer groups them (Req 2.2) when it
shows this project's own receipts.

## Requirement coverage

| Criterion | Module | Task |
|---|---|---|
| 1.1 | `app.js` | 9 |
| 1.2 | `repo.js`, `app.js` | 5, 9 |
| 1.3 | `receipt.js`, `app.js` | 3, 9 |
| 2.1 | `receipt.js`, `app.js` | 4, 9 |
| 2.2 | `receipt.js` | 4 |
| 3.1 | `canon.js`, `app.js` | 1, 9 |
| 3.2 | `canon.js` | 1, 2 |
| 4.1 | `files.js`, `app.js` | 7, 10 |
| 4.2 | `files.js`, `app.js` | 7, 10 |
| 4.3 | `files.js`, `app.js` | 7, 10 |
| 5.1 | `repo.js`, `app.js` | 6, 10 |
| 6.1 | `style.css`, `index.html` | 8 |
| 6.2 | `app.js`, `sample-receipt.json` | 11, 12 |

## Assumptions and open points

- **Repository name for the sample and for the page's links is unknown.** The workspace has no git remote. `SAMPLE_REPO`
  is set when the repository has a public home.
- **How a reviewer installs `necro` is not defined by the project yet** (the package is not published). The command uses
  `necro`, like the README.
- **Per-task freezing means a person pauses at each task.** If that is too slow, the alternative is to write all contracts
  and freeze once at the end, leaving `tasks.md` unticked until then. This design assumes per-task freezing because it is
  the behavior the gate enforces.
- Receipts can only be fetched from raw.githubusercontent.com in this version. GitHub `blob` links are refused with a
  message that says to use the Raw button.

## Play (Req 13)

The play lets a visitor send the gate a false "done", see it refused, apply the fix, see it accepted, and change one byte
to see the receipt fail. Tasks 24 to 26 build it in three parts: the files and the pure checks (task 24), the worker that
runs the contracts (task 25), and the page (task 26). This section is written with task 24 and says what the later tasks
will do, so they do not have to decide it again.

### Where the files live, and why (Req 13.1)

`site/play/` holds byte copies of every file that the risen receipt and `site/sample-buried.json` pin, taken from
`examples/pumpkin-ledger`. `site/` is the only folder GitHub Pages publishes, so the page cannot read the example in
place, and it must not fetch code from anywhere but its own origin (Req 13.10). The copies are the evidence that the
receipts describe real code, and the worker runs them, so they must be exactly the example's bytes. A contract
(`play-files.contract.test.js`, R13.1) compares them with the example, so a copy cannot drift.

```
site/play/
  risen-receipt.json                      written by the gate, never by hand
  kiro/specs/ledger/requirements.md       copy of .kiro/specs/ledger/requirements.md
  kiro/specs/ledger/runners.json          copy of .kiro/specs/ledger/runners.json
  bin/ledger.js
  contracts/ledger/postconditions.js
  contracts/ledger/{properties,requirement-1-read,requirement-2-split,requirement-3-settle,requirement-4-cli}.contract.test.js
  src/{balances,errors,money,parse,report,runtime,settle,split}.js
  test/gen.js
```

That is 18 copies and the receipt. The risen receipt pins more than the buried sample does: it also pins `runners.json`
and three locked files (`bin/ledger.js`, `contracts/ledger/postconditions.js`, `src/runtime.js`), because the gate of today
pins them. The buried sample is older and does not. The union is copied, so both receipts check against the same folder.
`site/lib/receipt.js` `pinnedFiles` lists requirements, contracts and sources only, so `site/lib/play.js` has its own
`playPins`, which lists the same files `necro verify` re-hashes (including `runners` and `frozen`).

### The risen receipt

`site/play/risen-receipt.json` is the receipt that `node bin/necro.js demo` printed when the gate accepted task 4 in a copy
of the example: spec `ledger`, task `4`, 18 contracts, all passing, `gitCommit` null (the demo copy is not a git
repository). It was copied from the path the demo printed. It is not edited, and its hash recomputes. Because it has no
commit, the page's file check against GitHub (Req 4.2) does not apply to it, which is why the play checks it against the
copies instead.

The buried side is `site/sample-buried.json`, which `necro check` wrote on a copy with the planted change. Every pin in it
matches the copies except `src/split.js`, whose pin is the hash of the planted version. The planted change is the one
`necro demo` makes (`Math.floor(cents / n)` becomes `Math.round(cents / n)`, and `const extra = cents % n;` becomes
`const extra = 0;`). `PLANTED_CHANGE` in `site/lib/play.js` holds those two pairs, and `applyPlanted` throws when the text it
is given does not hold them, so a wrong file is never passed off as the planted one.

### The path map

GitHub Pages may leave out folders whose names start with a dot, so `.kiro/specs/ledger/requirements.md` is stored as
`kiro/specs/ledger/requirements.md`. `copyPath` in `site/lib/play.js` is the one place that maps a pinned path to a copy
path: it drops a leading dot from each segment. `copyUrl(path, base)` adds the base, the `play/` folder and
`encodeURIComponent` for each segment. Pins keep their real paths everywhere else, because a hash check compares what the
receipt says, and `necro verify` prints the real path in its `MISMATCH` line. A test checks that no pin of either receipt
maps to a copy path with a dotted segment and that no two pins map to one copy.

### The pure module `site/lib/play.js`

| Export | Purpose |
|---|---|
| `PLAY_DIR`, `RISEN_RECEIPT` | Folder and file name of the copies and of the risen receipt. |
| `PLANTED_CHANGE`, `applyPlanted(text)` | The planted change, and a function that applies it or throws. |
| `copyPath`, `copyUrl` | The path map above. |
| `playPins(receipt)` | Every pinned file, once per (path, sha256). |
| `checkPlayFiles({ receipt, fetchFn, base, change })` | Fetch each copy from the page's own folder, apply `change[path](bytes)` when given, hash the bytes, compare with the pin. Status `match`, `different` or `unavailable`. |
| `changeOneByte(bytes)` | A copy with one byte changed (the low bit of the first byte), the same length. |
| `mismatchLine(result)` | `MISMATCH. Files changed: <sorted paths, comma and space>.`, the words `necro verify` prints, or `null`. |

`checkPlayFiles` follows the rules of `files.js`: fetch is injected, bytes are hashed (never text), an unsafe path is never
requested, and a copy that cannot be fetched is `unavailable`, never `different`. An unavailable copy gives no `MISMATCH`
line, because the page did not look. The module imports only `canon.js` and `repo.js`, so the rule that nothing in `site/`
imports `node:` or a bare specifier still holds.

### One byte (Req 13.4)

The step fetches the copies, changes one byte of the bytes of `src/split.js` in memory, hashes, and prints
`mismatchLine(result)`. Nothing is stored. The contract `R13.4` does the same change in a scratch copy of the example, runs
the real `necro verify` on the risen receipt, and requires the same line from both. `necro verify` stops at the changed
file before it re-runs any contract, so the line does not depend on the contracts.

### How the worker will load modules (Req 13.2, 13.3, 13.6, 13.7; task 25)

A throwaway spike, checked in Chromium and WebKit (Firefox was not tested), ran the seven contracts in a module Worker in
about 0.1 s. The worker fetches the files as text, builds `blob:` modules from them, and points `node:test`,
`node:assert/strict` and the relative imports at those blobs. Workers have no import maps, so the loader rewrites the
module specifiers in the text it has already hashed: the static `from './x.js'` of the `src/` files and the dynamic
`import('../../src/x.js')` of the contract files. It builds the `src/` and `test/gen.js` blobs first, in dependency order,
then the two contract files.

Task 25 adds four files for this, all under `site/lib/`, which `test/site-canon.test.js` scans (no `node:` import, no bare
specifier): `site/lib/play-worker.js` (the worker), `site/lib/play-loader.js` (reads the hashed text, rewrites the specifiers,
builds the blobs), `site/lib/play-node-test.js` (the `node:test` stand-in) and `site/lib/play-node-assert.js` (the
`node:assert/strict` stand-in). None goes under `site/play/`: R13.1 keeps that folder for the byte copies and
`risen-receipt.json` only, and fails on any other file there.

The seven contracts are `requirement-2-split.contract.test.js` (R2.1, R2.2) and `properties.contract.test.js` (R5.1 to
R5.5). Their imports are `node:test`, `node:assert/strict`, `src/split.js`, `src/parse.js`, `src/balances.js`,
`src/settle.js`, `src/report.js` and `test/gen.js`, plus `src/errors.js` and `src/money.js` through those. All of them are
pinned in the buried sample, so each run has a pin for everything it executes. The other 11 contracts need the ledger's
command line (they start a process), which a browser cannot do. The seven are a fixed list in the code, never inferred from
an error (Req 13.5).

Why this is safe to do outside the page's Content Security Policy: a dedicated worker loaded from the page's origin takes its
policy from its own response headers, not from the `<meta>` tag in `index.html`, and GitHub Pages sends none. With
`script-src 'self'` sent as a header on the worker, both engines refuse the `blob:` import. So the worker sits outside the
page's policy, and the policy in `index.html` stays as it is (Req 13.10). The safety comes from the worker, not from the
policy:

- It takes only a run name, `planted` or `fixed`. It takes no code, path or URL from the page, the paste box or the address.
- Before it builds any module it fetches the copies and checks each against the pin in the receipt for that run: the buried
  sample for `planted` (with `applyPlanted` applied to `src/split.js` first), the risen receipt for `fixed`. One mismatch
  stops the run before anything is built.
- It builds modules only from those hashed files and from the two stand-ins it ships. An import it does not know is refused.
- It stops after 10 seconds (Req 13.8).

The stand-ins are small. `node:test` provides `test(name, fn)` and runs the tests in order, recording pass or fail and the
assertion message. `node:assert/strict` provides `equal`, `deepEqual`, `ok` and `throws` with Node's strict behaviour for the
values the contracts compare. The page says so in one sentence (Req 13.7), and the contract `R13.7` compares the browser's
result for each of the seven with a real `necro check ledger` in Node on the same code.

### The fallback (Req 13.8)

A run ends in one of three ways: results, or a plain sentence plus the gate's full run from the receipts. The sentence covers
a worker that cannot start, a copy whose hash does not match, and a run past 10 seconds. After the sentence the page shows
the result of the gate's full run for that step: for the planted change, 9 failing of 18 from the buried sample, and for the
fix, 18 passing from the risen receipt. A step never stays on "running": a timer in the page ends a run even if the worker
never answers, and terminates the worker.

### The start control and the first screen (Req 13.9; task 26)

The frozen R9.5 contract needs the verdict banner fully inside the first screen. Measured today in headless Chrome:

| Window | Story strip | Banner | Spare below the banner |
|---|---|---|---|
| 1280x800 | 128 to 292 | 559 to 693 | 107 px |
| 390x844 | 97 to 388 | 714 to 836 | 8 px |

At 1280x800 there is room. At 390x844 there are 8 px, so the control may add no height there. The plan:

- The control is a button in the existing `.try` row of the story strip, in the grid cell beside the label "See it happen
  for real:", which today spans the whole row. The label takes the first column and the button the second. A label is one
  line high, so the button is sized to that line (`min-height` equal to the label's line, small padding) and the row does
  not grow.
- If the measured banner bottom at 390x844 moves, the pixels are taken back from the phone-width spacing of the strip
  (the gap between the evidence line and the bar, the beat padding), not from content. Task 26 measures both windows in
  headless Chrome and reports the numbers; the frozen R9.5, R10, R11 and R12 contracts must pass unchanged.
- The play is a `<section id="play" hidden>` placed directly after `#strip`, before the evidence line, and shown when the
  control is used. It is hidden in the first-visit view, so the first screen does not change until a visitor asks for it, and
  it needs no change to the banner logic: opening it does not call the code that brings the banner into view.
- Without scripts the control is not drawn: the page says nothing about the play, so a visitor never sees a button that does
  nothing (Req 13.9 says "with scripts on").
- No sentence the play adds may say that contracts run only in Node, and none may be a second sentence naming
  `necro verify`, JavaScript contracts and runner contracts, because the frozen R12.2 contract counts exactly one.

### What the browser does not do

The browser runs 7 of the ledger's 18 contracts. It checks hashes for the rest of the pins, and it does not start the
ledger's command line, so R1, R3 and R4 (11 contracts) are not run in the browser. The page says this next to every browser
run (Req 13.5) and shows the gate's full-run result from the receipts beside it. A browser run is a preview of the gate on
the same code, not a replacement for `necro verify`.

### Requirement coverage

| Criterion | Where | Task |
|---|---|---|
| 13.1 | `site/play/`, `site/lib/play.js`, `play-files.contract.test.js` | 24 |
| 13.4 | `site/lib/play.js` (`changeOneByte`, `mismatchLine`), `play-files.contract.test.js` | 24 |
| 13.2, 13.3, 13.6, 13.7, 13.8 | worker, loader, stand-ins | 25 |
| 13.5, 13.9, 13.10, and the page side of 13.2, 13.3, 13.4, 13.8 | `index.html`, `style.css`, `app.js` | 26 |

## Re-run box (Req 15)

Requirement 15 came from a stranger test on Nov 12: the command in the re-run box does not reach CONFIRMED for most of this
repository's own receipts. This section says what the box shows for each receipt and why the contracts for it
(`contracts/receipt-viewer/rerun-box.contract.test.js`, task 28) are shaped as they are. It changes `site/lib/repo.js`,
`site/app.js` and `site/index.html` only.

### What goes wrong today

Three causes, each seen on this repository's own receipts:

1. **A detached checkout.** The command does `git checkout <commit>`, which leaves HEAD detached. A contract in the
   receipt that clones the checkout finds no `origin/HEAD` in the clone (a clone of a detached HEAD does not set it), so
   R5.2's `git checkout origin/HEAD -- <receipt>` fails and `necro verify` prints `MISMATCH. Contracts changed: R5.2 ...`.
   Measured by hand in a scratch folder (macOS, git 2.51, Node.js 24.22, Chrome 157, a local copy of this repository
   standing in for GitHub): the command the page builds today for the receipt
   `.necro/receipts/receipt-viewer/a5577499...json` (commit 3596b034, `uncommitted` empty, pins R5.2) ends in that
   MISMATCH after about 8 s; with the checkout on a branch it prints `CONFIRMED a5577499...` after about 45 s. Not yet seen
   on Ubuntu CI.
2. **Files the commit does not hold.** The gate writes the receipt before the work is committed, so the receipt pins files
   that are not in the commit it names (`uncommitted` lists them). 47 of the 70 receipts under `.necro/receipts/` have a
   non-empty list. A clone at the commit cannot match their pins, whatever the command does.
3. **No commit.** A receipt written outside a git repository (the buried sample, a receipt from `necro demo`) has
   `gitCommit: null`. The command still clones, drops the checkout, and ends in `necro verify` on a receipt that is not in
   the clone.

### The three kinds

The box decides from `gitCommit` and `uncommitted` and from nothing else (15.4). It never reads the repository box for the
decision, the hash check, the contract results or the network.

| Kind | When | The box shows |
|---|---|---|
| clone | `gitCommit` is a full 40-character commit id and `uncommitted` is empty or absent | The clone command, as today, plus a checkout on a named branch (15.1). The two paragraphs about the verifier (Req 5.3) stay with it. |
| uncommitted | a valid commit and `uncommitted` holds at least one path | No clone command. A sentence saying the receipt was written before some of the files it pins were committed, so a clone at its commit cannot re-run it. The files, as a list. `necro verify <receipt path>` to run in the project's own working copy, with a copy button (15.2). |
| no-commit | `gitCommit` is null, absent, or not a full commit id | No clone command. A sentence saying the receipt names no commit, so it can be re-run only in the folder that made it. `necro verify <receipt path>` for that folder, with a copy button (15.3). |

Decisions the requirement leaves open, made here so a person can overrule them when they review:

- **No commit wins over a file list.** A receipt with `gitCommit: null` and a non-empty `uncommitted` is the third kind:
  without a commit there is nothing it could be "not in yet". The contracts only require that it gets no clone command and
  the local line.
- **A `gitCommit` that is not 40 lowercase hex characters counts as no commit.** `files.js` (`checkFiles`) and `verifyCommand`
  already treat it that way.
- **A missing `uncommitted` field is an empty list.** Receipts written before the field existed, and the frozen R5.1 and
  R5.3 contracts' receipts, have none, and they must keep getting the clone command.
- **The receipt's path is the default place**, `.necro/receipts/<spec>/<receiptHash>.json`, as in the clone command. The
  second and third kinds assume `necro` is installed where the reviewer runs the line (their own project), so the line is
  plain `necro verify <path>` without the verifier definition. That verifier-pinning exists to stop a cloned project from
  supplying its own verifier (Req 5.3); a reviewer who runs the line in their own working copy chose that verifier.

### The code

`site/lib/repo.js`:

- `verifyCommand({ repo, receipt })` keeps its signature and still returns a string. For a valid commit it now emits, in
  this order: `git checkout <commit>`, `git checkout -B necro-check`, `git checkout origin/HEAD -- <receipt file>`. The first
  step is kept as it is because the frozen R5.1 contract looks for `git checkout <commit>` after the clone. Both new and old
  steps start with `git checkout `, which the frozen R5.3 contract counts as project checkouts that must come before the
  verifier is cloned. `-B` rather than `-b` so a repository whose default branch is called `necro-check` still works; HEAD is
  detached at that point, so nothing is lost. For a receipt with no valid commit the command is as before (R5.3 asks
  `verifyCommand` for such a receipt), but the page does not show it.
- `localCommand(receipt)` returns `necro verify <path>`, with the path quoted by `shQuote` like every receipt field that
  reaches a command.
- `rerunPlan({ repo, receipt })` is the pure decision. It returns `{ kind: 'clone', command }`,
  `{ kind: 'uncommitted', files, command }` or `{ kind: 'no-commit', command }`. `files` holds the string entries of
  `uncommitted`, in receipt order. It does no I/O.

`site/app.js`:

- `updateCommand()` calls `rerunPlan` and shows the matching block. It still runs when the receipt is shown and when the
  repository box changes. Only the clone kind depends on the repository box.
- `NO_COMMIT_NOTE` and the `command-note` element go away: that note described a clone command without a checkout, which
  the page no longer shows. Two constants take their place, `UNCOMMITTED_WHY` ("This receipt was written before some of the
  files it pins were committed, so a clone at its commit cannot re-run it. These files were not in the commit yet:") and
  `NO_COMMIT_WHY` ("This receipt names no commit, so it can be re-run only in the folder that made it."). Each local block
  ends with one line saying where to run the command ("Run this in the project's own working copy:" for the second kind,
  "Run this in that folder:" for the third).
- File names come from the receipt and are untrusted: they are written with `textContent` into `li` elements.
- The copy button for the local line uses the same `copyText` as the others and shows the same `Copied.` and
  `Select the command and copy it.` notes.
- The Check files button (`runFileCheck`, `checkFiles`) is not touched (15.4).

`site/index.html`, inside `<section id="run">`:

```
h2 "Re-run it yourself"
div#run-clone                         the two existing paragraphs, pre#command, button#copy, span#copy-note
div#run-local[hidden]                 p#local-why, ul#local-files, p#local-where,
                                      pre#local-command, button#local-copy "Copy command", span#local-copy-note
```

Exactly one of the two blocks is visible at a time. `pre#command` stays the first `pre` with an id in the document (the
frozen R7.4 contract finds the re-run command that way), and `pre#local-command` comes after it. The text of the
Requirement 5.3 warning stays inside `#run`, in the clone block. `test/site-style.test.js` slices the page between
`id="run"` and `id="file-check"` to find it.

### The contracts

`rerun-box.contract.test.js` has one test per criterion. They are written against what the page shows, not against
`rerunPlan`, so the module that decides can be named otherwise.

| Test | What it does |
|---|---|
| R15.1 | Shows the committed fixture and reads the clone command from the box. Runs the project's part of that command (every step before the verifier is cloned) in `sh` against a local copy, then checks that HEAD is a named branch at the receipt commit, that the receipt file is in the checkout, and that a clone of the checkout has `origin/HEAD`. |
| R15.2 | Shows the uncommitted fixture. No visible line of the page holds `git clone` or `git checkout`. The box has the sentence (written before, committed, clone), says working copy, names both uncommitted files and no committed one, shows exactly `necro verify <path>`, and its one copy button copies that line. Typing another repository changes nothing. |
| R15.3 | The same for the buried sample and the demo receipt, with the sentence (names no commit, only, folder). |
| R15.4 | Eight receipts that differ only in `gitCommit`, `uncommitted`, spec and a made-up hash, shown one after another on one page with the repository box filled and empty: the kind follows the two fields, nothing is left over from the receipt before, and the page fetches nothing. Then the Check files button on the four fixtures with a fetch that answers 404: files at the commit are requested, uncommitted files are marked and never requested, and a receipt with no commit is told the check needs a commit. |
| R15.5 | The four fixtures get a clone command only if committed. Then the committed fixture's command runs in `sh` with git and node and no `necro` against a local copy of this repository, and must print `CONFIRMED <hash>` and exit 0. |

How the local copy is made, and why it differs from R5.2's: R5.2 points git at this repository's own folder. These
contracts first make a bare repository from this repository's HEAD with `main` as its default branch, and point git at that.
GitHub always has a default branch, and a pull-request build checks this repository out detached, whose clone would have no
`origin/HEAD` for reasons that have nothing to do with the command. Git's own configuration is switched off with
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. HOME is the real one, not an empty folder as in R5.2: the
fixture's receipt pins page contracts that start a headless Chrome, and Chrome hung on macOS with an empty HOME (seen with
Chrome 157). R5.2 still checks that the command changes nothing outside the folder it clones.

Fixtures, all existing files, with their shape asserted before use so a change to one cannot turn a test into another test:

| Fixture | Why this one |
|---|---|
| `.necro/receipts/receipt-viewer/a5577499...json` | Commit 3596b034, `uncommitted` empty, pins the R5.2 contract, 39 contracts, task none. Its checkout re-runs in about 45 s, most of it the nested R5.2 run. The other receipts that pin R5.2 and have an empty list (up to 7edf93aa, 74 contracts) re-run more contracts, and every one of them starts browser contracts too; none was timed. |
| `.necro/receipts/receipt-viewer/00e62843...json` | Commit 1d17794d, two uncommitted files (`site/app.js` and the R13 page contract). |
| `site/sample-buried.json` | `gitCommit` null, no `uncommitted` field. |
| `site/play/risen-receipt.json` | What `necro demo` writes. `gitCommit` null. |

What the contracts do not do: re-run the risen sample (R5.2 does, through the same command), test a `gitCommit` that is not a
full commit id, or test a receipt with no commit and a file list beyond "no clone command". R15.5 needs a Chrome or
Chromium on the machine, as the receipt it re-runs does; set `CHROME_PATH` when it is not in a usual place.

Checked in a scratch copy of the repository with this design applied: all five tests pass (R15.5 in about 46 s), and the
frozen R5.1, R5.2, R5.3 and R7.4 contracts still pass. On the current code all five fail (task 28 lists why).

### Requirement coverage

| Criterion | Where | Task |
|---|---|---|
| 15.1 | `site/lib/repo.js` (`verifyCommand`), `rerun-box.contract.test.js` | 28 |
| 15.2 | `site/lib/repo.js` (`rerunPlan`, `localCommand`), `site/app.js`, `site/index.html` | 28 |
| 15.3 | `site/lib/repo.js` (`rerunPlan`, `localCommand`), `site/app.js`, `site/index.html` | 28 |
| 15.4 | `site/lib/repo.js` (`rerunPlan`), `site/app.js` | 28 |
| 15.5 | `rerun-box.contract.test.js` | 28 |

## Try it first, the real case, the long receipt folded (Req 16)

Requirement 16 came from a person's review on Nov 16: the page should show its best part (the play) and its strongest
evidence (a real fix in a real repository) before anything else, and the 81-row receipt should not push "How it works" a
screen and a half down. It changes `site/index.html`, `site/style.css` and `site/app.js` only (tasks 29 to 31). Requirement
16.7 (the browser lookup of the contracts) changes contract files only, and is designed in "The browser lookup (16.7)" below.

### The play opens on load (16.1, 13.9 as revised)

- `#play` stays `hidden` in `index.html`, so with scripts off neither the play nor Try it here is drawn (13.9).
- `setUpPlay()` in `app.js` takes `hidden` off `#play` when the page starts and sets `aria-expanded="true"` on
  `#strip-play`. Nothing waits for a click. The play no longer sits after the strip: it sits directly after the result
  element, so the element before `#play` in the DOM is `#evidence`.
- Try it here stays in the strip, as the single filled control (14.3). Pressing it does two things:
  1. `#play.scrollIntoView(...)` as today, with `scroll-margin-top` on `.play` giving the small margin above the play's
     heading (the rule that `play-page.contract.test.js` R13.10 already checks, unchanged). It scrolls on every press, also
     when the play is already partly in view. Reason: 13.9 says it scrolls, the unchanged R13.10 contract needs the page to
     move at 1280x800 where the play is partly in view, and a press that does nothing visible looks broken. If the play's
     heading is already at that margin, the scroll is a no-op. Smooth scrolling stays off under reduced motion.
  2. Focus goes to `#play-send` (the Send the tick button), with `focus({ preventScroll: true })`, so the focus move does
     not fight the scroll. It used to go to `#play-title`. `#play-title` keeps `tabindex="-1"`, because the receipt-viewer
     contracts and a screen reader still find the heading; only the focus target changes.
- It still does not call the code that brings the verdict banner into view (9.3 is for receipts the user opens).

### The new page order (16.2, 10.2, 12.1)

The DOM order is the visual order (10.4). Top to bottom:

| # | Part | Element | Moves? |
|---|---|---|---|
| 1 | brand and heading | `header#brand` (mark, eyebrow, `h1`, idea line) | no |
| 2 | real-use line | `p#real-use` | new |
| 3 | story strip | `section#strip` | no |
| 4 | result element | `p#evidence` | up, from after the play |
| 5 | play | `section#play` | down, from before the result |
| 6 | How it works | `section#how` | up, from after the receipt |
| 7 | sample bar | `section#start` (`#sample-row`, the jump link) | down |
| 8 | open your own receipt | `details#open`, inside the sample bar | down |
| 9 | static summary (scripts off, see below) | `section#static-summary` | new |
| 10 | verdict banner | `section#verdict` | down |
| 11 | receipt | `section#receipt` | down |
| 12 | hash check, re-run command, file check | `#hash-check`, `#run`, `#file-check` | no |
| 13 | about | `section#about` | no |

The only headings above the banner are the page heading (`h1`), the play's heading (`h3#play-title`) and `h2` "How it
works" (10.1). The real-use line, the result element, the static summary and the folded requirements use no heading
element, so the frozen headings check in `story.contract.test.js` (R10.1) and `first-screen-v3.contract.test.js` stays
exact. The jump link (10.5) stays in the sample bar. It now jumps up, to a section that is directly above the bar, and the
text "How it works, and try it" still reads right. No CSS reorders anything (10.4).

### The real-use line (16.3)

`<p class="real-use" id="real-use">` directly after `</header>`, before the strip. Plain text and two plain links, no
script, no `hidden`. The words, which the contract reads as text:

> Used on a real repository: in judge-protocol the gate refused Kiro's first tick, which had built only half of a
> criterion, and the finished fix passed all six frozen contracts and was merged (pull request #29). Read the case study.

- "pull request #29" is the link text of the first link, `https://github.com/vijaygopalbalasa/judge-protocol/pull/29`.
- "the case study" is the link text of the second, `https://github.com/vijaygopalbalasa/contract-necromancer/tree/main/case-studies/judge-api-errors`
  (the folder in this repository; the page is on GitHub Pages, so a relative link would not reach it).
- No em or en dash, and no sentence that names `necro verify`, so the frozen R12.2 sentence count (exactly one sentence names
  `necro verify` with JavaScript contracts and runner contracts) is not touched.
- Both facts come from `case-studies/judge-api-errors/README.md` and the README ("the gate refused a half-done tick, and the
  fix is merged"). The contract checks the pull request address and that the folder exists in this repository.

### The experiment size in the result element (16.4)

A new `<span class="size">` inside `p#evidence`, between `.result` and `.caveat`: "Two models, 3 to 5 runs per cell (a cell
is one model with one arm)." The counts are `experiments/README.md` word for word: its Limits section says "3 to 5 runs per
cell, two small models", and its header says "across two models". The contract reads "N to M runs per cell" out of
`experiments/README.md` and requires the same words in the element, so the two cannot drift. The element keeps its one link,
the counts "11 of 11" and "0 of 19" as `strong.num`, and the round 3 caveat (12.1, 14.2).

### The receipt folded (16.2)

- `renderGroups` in `app.js` writes one `<details class="group">` per requirement, closed, with
  `<summary>Requirement 4 (20 of 20 pass)</summary>` (the text the `h3` has today) and the `ul.contracts` inside. A receipt
  with no requirement numbers keeps its one "Contracts" group, also folded. Every render starts folded, including the second
  receipt a visitor opens.
- One control, `<button type="button" id="groups-toggle">Unfold all requirements</button>`, sits in `#receipt` above
  `#groups`. It sets `open = true` on every `details` in `#groups`. It stays one-way: a visitor folds one requirement by its
  summary. Its label has no "show" and no "sample", because the fake-DOM contracts (`clean`, `look`, `first-visit`) find
  buttons by those words.
- The verdict banner, the receipt facts, the hash check, the re-run command and the file check do not change (3, 4, 7, 15).
  The rows are the same `li.contract` elements, so the contracts that read rows still find them; a row in a folded `details`
  is in the DOM but not drawn.
- Nothing is lost: all 81 rows are in the page; only their drawing is folded.

### The static summary for scripts off (16.6)

- `<section class="card" id="static-summary" aria-label="The sample receipt, in short">` between the sample bar and the
  verdict banner, written by hand in `index.html` from `site/sample-receipt.json`: a line `<p class="static-verdict">A risen
  receipt: 81 contracts alive.</p>` and `<ul class="static-requirements">` with one `<li>` per requirement,
  `Requirement 1 (3 of 3 pass)` to `Requirement 10 (5 of 5 pass)`. The words "Risen" and "Still buried" are left to the live
  banner (lower case "risen" here), and the parts have classes, not ids: `first-visit.contract.test.js` looks for "Risen" in
  the text of every element with an id, and must not find a second one next to the live banner. No heading, no button.
- `app.js` sets `hidden` on `#static-summary` when the first receipt is shown, so with scripts on a visitor never sees two
  summaries. With scripts off it is drawn, and the receipt card, verdict banner and checks stay hidden as today.
- A contract compares the static text with `site/sample-receipt.json`: the verdict word and count, and each line, worked out
  from the receipt by grouping names `R<n>.`. It also checks that, with scripts on, the live `summary` lines equal the static
  lines. If the sample is regenerated and the page is not, a contract goes red.
- With scripts off the first screen still shows the heading, idea line, real-use line, three beats and the result element
  (all plain HTML today and after this change).

### Risk: the first screen at 390x844 on a machine with other fonts (CI)

A first screen that holds Try it here, the real-use line and the whole result element is tight at 390x844. A throwaway,
unstyled prototype of the new order with the text above, measured in headless Chrome on this Mac, gave:

| Window | Real-use line | Result element | Two counts end at | Spare under the result | Spare under the counts |
|---|---|---|---|---|---|
| 1280x800 | 112 to 189 | 399 to 530 | 454 | 270 | 346 |
| 390x844 | 137 to 265 | 588 to 832 | 693 | 12 | 151 |

So at 390x844 the whole result would end 12 px above the fold here, and a runner with a wider font would push it over.
The decisions:

1. The contracts at 390x844 check only Try it here, the two large counts and the real-use line (9.5 as revised). The whole
   result element is checked at 1280x800 only. That is why three frozen checks that asked for the whole result at 390x844
   are revised (`evidence.contract.test.js`, `first-screen-v3.contract.test.js` R12.1 and R9.5).
2. No contract checks a distance or a spare margin: that would pin Mac pixels (16.5). The 120 px is a target the person
   building the page checks by hand: trim or tighten the text above the result so that at 390x844 on this Mac the whole
   result ends at least 120 px above the fold (it ends at 724 or higher up; the prototype ends at 832, so about 110 px must
   go). Candidates, in order: the real-use line at 0.875rem with a line height of 1.4 and no more than four lines (about 40
   px), shorter beats and tighter beat padding in the strip at phone width (about 50 px), the gap between rows of the strip,
   the margin around the result. Do not shorten the counts, the round 3 caveat or the size sentence.
3. Report the measured numbers for both windows in the task report, as task 27 did.

### The contracts

All use real Chrome through a copy of the browser helper carried in the file (no shared helper file: it would not be frozen;
`test/fixtures/browser.js` is the template, as in the other receipt-viewer contracts). They read DOM order, open or folded
state, text, and whether an element is inside the window. No pixel size or position. A test that cannot find a browser
skips with a reason that starts with `cannot run:` (16.7); see "The browser lookup (16.7)" below.

| File | Tests |
|---|---|
| `try-first.contract.test.js` (new) | R16.1 play open on load, directly after the result, none of it with scripts off; R16.1 Try it here puts focus on Send the tick and leaves the heading and the button in the window; R16.1 the whole page order, in the file and in the DOM (it also covers the order sentence of 16.2, so the fold task does not wait for it); R16.2 verdict banner, one folded summary line per requirement, one unfold-all control, nothing else lost; R16.2 one requirement folds and unfolds, a second receipt starts folded; R16.3 the real-use line (text, two links, no dash, after the heading, before the strip) and drawn with scripts off; R16.4 the size sentence against `experiments/README.md`; R16.5 no pixel size in this file; R16.6 first-screen text with scripts off, the static summary against `site/sample-receipt.json`, and static summary hidden with scripts on |
| `video-link.contract.test.js` (new) | R10.3 the page's video link equals the first youtu.be link in README.md, and the page has no other youtu.be link; R10.3 every youtu.be link in README.md is the page's video link. Both pass now and after the final cut replaces the earlier one. Neither names a cut. No contract fails on purpose, because CI runs every contract file (see task 32). |
| `no-browser.contract.test.js` (new) | R16.7 one test per browser contract file, found by scanning `contracts/receipt-viewer` (no list; it leaves itself out), run as a child with `CHROME_PATH` set to a path that does not exist (see "The browser lookup (16.7)"). It needs no browser. |

Revised frozen contracts, each keeping its old intent where it still holds (a person freezes `receipt-viewer` again):

| File and place | What changed |
|---|---|
| `above-fold-v2.contract.test.js` R9.5 (was line 259) | Try it here, the real-use line and the result (whole at 1280x800, two counts at 390x844) replace the banner in the first screen. No sideways scroll and the open-your-own-receipt control are kept. |
| `first-screen-v3.contract.test.js` R9.5 at 1280x800 (was 466), R9.5 at 390x844, R12.1 | Same revision. The R12.1 first-screen check at 390x844 now asks for the two counts. |
| `first-screen-v3.contract.test.js` R14.1 title test (was 259) | The headings above the banner are exactly the page heading, the play's heading and "How it works". |
| `first-screen-v3.contract.test.js` R14.3 | Extended: the play's three buttons must be among the controls above the banner and must not share Try it here's fill. They must not share its glow, animation or gradient either, but each of those three is compared only when Try it here sets one (today it has a fill and a box-shadow glow, no animation and no gradient), so an unrelated animation or icon background on another control cannot fail it. |
| `evidence.contract.test.js` R12.1 first screen (was 304) | The banner is no longer required in the first screen; the whole line at 1280x800, its two counts at 390x844. |
| `play-start.contract.test.js` R13.9 (was 265) | The banner is no longer required in the first screen. |
| `play-page.contract.test.js` R13.9 (was 595, 613 to 615), R13.9 lock test (was 635), R13.10 keyboard (was 662) | The play is open on load; it is the element after the result element (DOM order replaces a 20 px gap); focus goes to Send the tick and the heading and the button are in the window; the lock test keeps its pins and its comparison of each listed file with the lock's hash (now with `first-screen-v3` in the list) and, as frozen, child-runs only the R9.5 file (`above-fold-v2`); the keyboard test starts on Send the tick. R13.10 scroll (line 493) is not changed. |
| `story.contract.test.js` R10.1 (was 147), R10.2 (was 154 to 157), R10.4 (was 224), R10.3 | Headings above the banner; How it works follows the play and comes before the sample bar; the new order; the video link is the first youtu.be link in README.md. |
| `jump.contract.test.js` R10.5 (was 75) | The new order; the comparison of `above-fold-v2` with the lock's hash is kept. |
| The ten browser contract files (see "The browser lookup (16.7)"), each in its own lookup and in the tests that need a browser | The 16.7 lookup and skip. |

### Where criteria seem to pull against each other

- **9.5 and the old checks at 390x844.** 9.5 asks for the two counts only, but `evidence.contract.test.js` and
  `first-screen-v3.contract.test.js` also asked for the whole result there. I followed 9.5 and revised both; leaving them
  would bring back the font dependence that 9.5 removes.
- **13.9 and "scroll when the play is not in view".** 13.9 says Try it here scrolls. I scroll on every press (see above),
  because the unchanged R13.10 contract needs it. A press when the play is already at the margin does nothing visible.
- **10.3 equal to the README now.** The page and the README point at the same cut today, so "the same URL" holds. Both
  video-link tests pass now and keep passing after the swap. They do not name a cut, because no contract may fail on
  purpose (CI runs every contract file). Nothing in the contracts makes a person upload the final video; task 32 says so.
- **13.9 and 16.2 against frozen file hashes.** 13.9 says the frozen contracts for 9, 10, 11 and 12 "as revised" pass. Two
  contracts (the play-page lock test and `jump`) compare contract files with the lock's hashes. `necro freeze` re-pins every
  contract file of the spec, so once a person has frozen the revised files these comparisons pass. Until then they are
  EXPECTED to fail for every revised file: that is the review step, not a bug. They are kept on purpose and must not be
  dropped. A revised file differing from its old pin is the reason for the freeze, not a reason to remove the check.
- **The hash comparisons and "no contract fails on purpose".** The comparisons above fail until a person freezes. They do
  not fail to force a human step by design of their own: they fail only while a reviewed file has not been re-pinned, and
  pass from the freeze on without any edit. This is the one place where the two ideas meet, and the freeze is the answer.
- **16.7 and the tests that are partly static.** A test that needs a browser for one step (the child runs in `jump` R10.5,
  the play-page lock test and `rerun-box` R15.5, and a few page tests that read text first) skips as a whole when there is
  no browser, so its static checks do not run either. Splitting each would add contracts and change names. A skipped test
  never passes, so nothing is hidden, but a machine with no browser also learns nothing from the static half.
- **16.6 and `first-visit.contract.test.js`.** A static "Risen" in an element with an id would break that frozen contract, so
  the static summary uses lower case and classes (above). Not a conflict between criteria, but a reason for the wording.

### Requirement coverage

| Criterion | Where | Task |
|---|---|---|
| 16.1 | `app.js` (`setUpPlay`), `index.html`, `try-first.contract.test.js` | 30 |
| 16.2 | `app.js` (`renderGroups`, `groups-toggle`), `index.html`, `style.css`, `try-first.contract.test.js` | 31 |
| 16.3 | `index.html`, `style.css`, `try-first.contract.test.js` | 29 |
| 16.4 | `index.html`, `style.css`, `try-first.contract.test.js` | 29 |
| 16.5 | every Requirement 16 contract, `try-first.contract.test.js` R16.5 | 29, 30, 31 |
| 16.6 | `index.html`, `app.js`, `try-first.contract.test.js` | 31 |
| 16.7 | the ten browser contract files (their own lookup and skip), `no-browser.contract.test.js` | 33 |
| 9.5, 10.1, 10.2, 10.5, 12.1, 13.9, 14.3 (revised) | `index.html`, `style.css`, `app.js`, the revised contracts above | 30 |
| 10.3 (revised) | `index.html`, `README.md`, `video-link.contract.test.js` | 32 |

### The browser lookup (16.7)

Rule, in every contract file that needs a browser: when `CHROME_PATH` is set, only that path is tried (a path that is not a
file means no browser); otherwise the usual macOS, Linux and Windows install paths, then the folders of `PATH`. With no
browser, `NO_BROWSER` is the string `cannot run: no Chrome or Chromium found (set CHROME_PATH)` and every test that needs a
browser is declared with `{ skip: NO_BROWSER }`. A skip with that prefix is reported by `necro verify` as not run (necro-core
6.17) and still counts as failing in the gate (necro-core 4.7 and 6.16), so a layout that was not measured never passes.

Files found by behaviour (what the code does, not a hand list):

| Kind | Files | Skipping tests |
|---|---|---|
| Own lookup (`findBrowser`) and its own headless Chrome | `above-fold-v2`, `evidence`, `first-screen`, `first-screen-v3`, `play-start`, `play-page`, `play-run`, `try-first`, `kiro-session` (new Nov 17), `story` (since Nov 17, for its one computed-style test, R10.4) | every test that calls `withBrowser` |
| Child run that needs a browser | `jump` (R10.5 runs `above-fold-v2`), `play-page` (the R13.9 lock test runs `above-fold-v2`), `rerun-box` (R15.5 re-runs a receipt whose page contracts start Chrome) | the whole test, so a child run that measured nothing never counts as a pass |
| Checked and found to need none | `look`, `clean`, `first-visit` (a fake DOM, text only), `canon`, `receipt`, `repo`, `files`, `sample`, `style`, `play-files` (hashes and `necro verify` of the ledger example), `fresh-clone` and `pinned-verifier` (re-run a `necro-core` sample and a fake repository) | none |

`rerun-box` hands the browser it found to the child as `CHROME_PATH`, because the child's `PATH` holds only git and node.

`no-browser.contract.test.js` needs no browser. It reads `contracts/receipt-viewer`, takes every contract file (except itself)
whose code, comments left out, reads `process.env.CHROME_PATH` or starts a browser with `--remote-debugging-port`, and
runs each as a child with `CHROME_PATH` set to a path that does not exist. One test per file passes only if every skip
reason starts with `cannot run:` and names the browser and `CHROME_PATH`, the file shows at least one such skip, and no
test fails with the missing-browser error. It was RED on the earlier lookups, which ignored a `CHROME_PATH` that pointed
nowhere and went on to find Chrome in `/Applications`, and is GREEN with the new ones (task 33).

Which files change: only contract files. The lookups live in them, so `site/`, `src/` and `bin/` are not touched and the
build has nothing to implement for 16.7. A person freezes `receipt-viewer` again after reviewing the new
`no-browser.contract.test.js` and the revised files.

## Truth fixes and the real Kiro session (Req 10, 11, 13, 14 revised Nov 17; Req 17)

A person's review of Nov 17 revised eight criteria (10.1, 10.2, 10.3, 10.4, 11.2, 11.3, 13.5, 14.1) and added Requirement 17.
The revisions make the page say only what is true (a hook cannot stop a shell command, some receipts need more than a
browser to re-run, the play ran 7 of 18 contracts and did not say so before a button), stop two things that failed on a
phone (the demo command broke inside a word; the third beat of the strip was still invisible at 1.3 s), and add one still of
the real Kiro session of Nov 8 to the header. The work changes `site/index.html` and `site/style.css` only; `site/app.js`
is not touched. Tasks 34 and 35 do it. A task line names every criterion it needs, one by one, and never a range: the gate
reads only the numbers written in the `(Req ...)` group and does not expand `17.1 to 17.4`, which records 17.1 and 17.4 only
(`criteriaOf` in `src/lock.js`). With task 32 open a tick requires only the contracts whose names start with the recorded
criteria (`requiredNames`), so task 34 names every criterion its change can break, all of which pass on a page where 34 is
done and 35 is not, and task 35 names the first-screen criteria, 17.1, 17.2, 17.3 and 17.4 one by one, and also 10.2, 11.2 and 13.5, so it guards task 34's own fixes as well. The contracts are drafts for a person to review and
freeze: `kiro-session.contract.test.js` (new) and the revised `story`, `first-screen-v3`, `first-screen` and `play-page`
files (see "The contracts of Nov 17" below).

### The heading and step 3 (10.1, 14.1, 10.2)

- The page heading, the one `h1` in `header#brand`, becomes `A Kiro task is done only when its frozen contracts pass.` The
  reason is in 10.1: "cannot" overstated what hooks can stop. Nothing else in the header changes: the eyebrow, the idea line
  of 14.1 (`p#idea`) and the title of 11.5 stay as they are. The title already says "a task is done only when frozen
  contracts pass", so the heading and the title now agree.
- Step 3 of "How it works" becomes `Every passing task leaves a receipt you can re-run.` The three steps stay an ordered
  list of three. Nothing else in the section changes. The README, the docs and the video are out of scope.
- The headings above the banner stay exactly the page heading, the play's heading and "How it works", in that order. The
  figure of Requirement 17 has a caption and no heading.

### The demo command on one line (10.4, 11.3)

The command is drawn twice: `code#demo-command` inside `pre.demo` in "How it works", and `code#strip-command` in the strip
(`.try`, a grid). Today both wrap anywhere, because `pre` has `white-space: pre-wrap` and `.try code` has
`overflow-wrap: anywhere`. At 390 px that split the command inside a word. The rule now has two sides:

| Element | Computed style the page must give | Why |
|---|---|---|
| `#demo-command` | `white-space` `pre` or `nowrap`; its box is `pre.demo`, with `overflow-x: auto`, `max-width: 100%` | the code element is inline text inside the `pre`, and `overflow` does not apply to inline text. The `pre` holds only this command, so it is the command's own box |
| `#strip-command` | `white-space: nowrap`, `overflow-x: auto`, `min-width: 0`; drop `overflow-wrap: anywhere` | it is a grid item, so it is a block box and scrolls by itself. `min-width: 0` is kept but not needed: measured without it, the page does not overflow, because a grid item that is a scroll container (`overflow-x: auto`) has an automatic minimum width of 0. What does overflow the page is a grid column sized to its content (`max-content`) on a phone, and the contract catches that |
| every other `pre` and `code` | unchanged: `pre` keeps `pre-wrap` and `overflow-wrap: anywhere`, inline `code` wraps | 10.4: other code blocks keep wrapping (the re-run command, the diff lines, the file check) |

Write the new rules on `.demo` and `.try code` only. Do not change the base `pre` rule. The copy buttons copy the same text
as before, and the text of both elements stays `npx -y github:vijaygopalbalasa/contract-necromancer demo` with no markup
inside. A scrolling box can be reached by keyboard in current Chrome without a `tabindex`, so none is added.

The contract reads computed styles in real Chrome (`story.contract.test.js`, R10.4 as revised), and the CSS text as well, so
no selector can slip past either: for the two commands, `white-space`, the `overflow-x` of the command's own box, one drawn
line and the page not scrolling sideways at 390x844; for every other `pre` and `code`, drawn or not (computed `white-space`
is read for hidden elements too), `white-space` not `nowrap` or `pre`. The static test keeps the old ban on `white-space: pre`
or `nowrap` for every rule that styles How it works, except a rule whose every selector names only the demo command's own box
(`.demo`, `pre.demo`, `.demo code`, `#demo-command`), and refuses the same on any other rule that names a `pre` or `code`
element. It checks no width, so a different font cannot fail it. Under mobile emulation Chrome widens `innerWidth` and
`innerHeight` to the content when a page is wider than the window (measured: `innerWidth` 652 and 510 while
`document.documentElement.clientWidth` stayed 390 on two pages that scrolled sideways), so `scrollWidth > innerWidth` is never
true there. The contract therefore asserts that `innerWidth` is the width asked for, and compares `scrollWidth` of the page
and the body, and the right edge of each command box, with `document.documentElement.clientWidth`. The command being longer than its box at 390 px is not asserted
either, because that depends on the font: if a font makes it fit, the box simply does not scroll.

### The strip timing (11.2)

Today `.beat` runs `rise` for 600 ms, and beats 2 and 3 start at 350 ms and 700 ms, so the last beat is fully drawn at
1.3 s. A phone reviewer's first screenshot, taken earlier than that, showed the third beat blank. 11.2 now asks that for
each beat the animation delay plus the animation duration is at most 500 ms.

- Inside the existing `prefers-reduced-motion: no-preference` block set `animation-duration: 300ms` on `.beat` and the
  delays to `0ms`, `80ms` and `160ms` on the first, second and third beat. The last beat ends at 460 ms, which leaves 40 ms
  under the limit so that no rounding in a computed value can cross it. Keep the `rise` keyframes as they are: other
  elements use them.
- Under `reduce` nothing changes: the block that sets `animation: none !important` stays, so all three beats are there at
  once with no animation. With scripts off nothing changes either, because the animation is CSS only and never hides text
  that CSS cannot show.
- The contract adds only the sum. It reads the computed `animation-delay` and `animation-duration` of each beat under
  no-preference (comma lists are summed per animation) and asks that each sum is at most 500 ms. It keeps the reduce check
  and the check that the beats do animate under no-preference, so the sum cannot pass because nothing is animated.

### The sentence above the play's first button (13.5)

Before any button is pressed the play (open on load, 16.1) says nothing about the 7 of 18. The new sentence goes in
`section#play` directly before `ol.play-steps`, so it sits after the diff box and directly above the first step and its
button:

`The browser runs 7 of the ledger's 18 contracts, and the other 11 need the ledger's command line.`

- It is a `p` (class `play-before`, no id needed) and one sentence. It is plain text in the HTML, because the play is
  hidden with scripts off (13.9) and the sentence needs no script.
- The numbers 7, 18 and 11 must equal the numbers of the sentence after a run (`scopeLine` in `app.js`: the fixed list of
  seven, the ledger's total from the receipts, and total minus seven). Writing them twice is the drift that 13.5 forbids,
  so the unit test of task 34 reads both and compares them, and the contract (R13.5 as revised) does the same in Chrome:
  before any press it reads N, M and the rest from this sentence, requires N to be the seven, M to be the receipts' total
  and the rest to be M minus N, and after each run requires the numbers of the post-run sentence to equal them.
- The wording differs from the post-run sentence on purpose ("runs" and "need" against "ran" and "start"), so the contract
  that finds the post-run sentence by its text cannot read this one. It adds no sentence that breaks R12.2: it says nothing
  about running only in Node.

### The figure of Requirement 17 (17.1 to 17.4)

Markup, inside `header#brand`, as the last child, after the `div` that holds `p#idea` and before `</header>`. The real-use
line then still follows the header directly (16.3).

```html
<figure class="session">
  <img src="data:image/webp;base64,..." alt="I couldn't mark task 4 complete. A hook blocked the edit to tasks.md and reported failing contracts, so the checkbox is still [ ].">
  <figcaption>"I couldn't mark task 4 complete. A hook blocked the edit to tasks.md and reported failing contracts, so the checkbox is still [ ]." <span class="session-label">Real Kiro session, recorded Nov 8, not a simulation.</span></figcaption>
</figure>
```

- **Caption (17.1).** The quoted words in straight quotation marks, one space, then the label. It is plain text in the HTML,
  so it reads with scripts off, and it is drawn at every width. No dash, no link.
- **Image (17.2).** One `img`. `src` is `data:image/webp;base64,` followed by the base64 of the exact bytes of
  `site/kiro-session-nov8.webp` (11,578 bytes, 15,440 characters of base64). The file stays in `site/` as the source of the
  bytes. The page never requests it. `alt` is the quoted words, character for character. The policy already allows
  `img-src data:`, so it stays byte for byte as it is, and `look.contract.test.js` R8.2 (images must be `data:`) holds.
- **Drawn from 52rem up only.** `figure.session img { display: none; }` as the base rule, and
  `@media (min-width: 52rem) { figure.session img { display: block; max-width: 36rem; height: auto; } }`. The width limit is a
  layout choice (see "Risk" below): it keeps Kiro's words readable at about three quarters of their size and gives back about
  30 px at 1280x800. A column of 52rem or more is always wider than 36rem, so the limit never needs `100%`. Below 52rem the
  image is not drawn and the caption carries the words. No `picture`, no `srcset`, no `loading` attribute: a `display: none`
  image from a `data:` URL costs no request.
- **Layout.** `.intro` is a flex row (mark, then the text `div`). The figure must go on its own row under them: give
  `.intro` `flex-wrap: wrap` and the figure `flex: 0 0 100%` and `margin: 0`. Without this a third flex item squeezes the
  title into a narrow column, which a prototype measured at 306 px of extra height at 390 px wide. Give the caption the same
  small type as the real-use line and set its `color` as a hex or `var()` of one, because R8.2 checks contrast on every rule
  that sets a color.
- **No link, no video, no animation (17.3).** The figure holds an `img` and a `figcaption` and nothing else. No `a`, no
  button, no handler. No rule that sets `animation` may match the figure or anything in it: `.mark-check` and `.verdict`
  are the only header-area animations today, and neither does. The contract reads the computed `animation-name` of the
  figure and everything in it.
- **Why the caption is a text copy of the alt text.** A screen reader gets the words twice where the image is drawn (the
  alt text and the caption). That is the price of 17.1 asking for the words as text and 17.2 asking the same words as alt.
  The contract compares the two, so they cannot drift.

### Risk: the first screen in CI with the figure (17.3, 9.5)

R9.5 (revised Nov 16) is the frozen contract that decides whether the figure fits: at 1280x800, Try it here, the real-use
line and the whole result element in the first screen; at 390x844, only Try it here, the two large counts and the real-use
line. The figure sits above all of them, so every pixel it adds pushes them down, and a runner with a wider font than this
Mac makes it worse.

**How it was measured.** The first table of this section came from an unstyled prototype and was wrong by a wide margin. The
numbers below come from a review of Nov 17: a page built to this design, with the image drawn at its natural width in the
752 px column, was measured in headless Chrome on a Mac and in a Linux container with Chromium and DejaVu fonts, each at
1280x800 and 390x844 (the distance from the bottom of the part that must fit to the fold). The "no figure" rows are the page as
it is today, measured on the Mac in this session.

| Window | What is drawn | Where it ends | Spare under the part that must fit |
|---|---|---|---|
| 1280x800 | no figure (today, Mac) | whole result ends 472 | 328 |
| 1280x800 | figure, image at its natural width, Mac | whole result ends 104 px above the fold | 104 |
| 1280x800 | figure, image at its natural width, Linux (Chromium, DejaVu) | whole result ends 66 px above the fold | 66 |
| 1280x800 | figure, image at `max-width: 36rem`, either | about 30 px more than the two rows above | about 134 (Mac) and about 96 (Linux) |
| 390x844 | no figure (today, Mac) | lower count ends 576 | 268 |
| 390x844 | figure with the caption only, Mac and Linux | lower count ends 120 px above the fold | 120 |

The last two figures of the `max-width` row are the reviewer's numbers plus the "about 30 px" the limit gives back; they were
not measured on Linux. A scratch build of this design made in the same session measured, on the Mac, 111 px under the whole
result with the image at its natural width and 140 px with `max-width: 36rem`, which agrees with the 30 px. No contract pins
any of these numbers (17.4, 14.5, 16.5). What follows from them:

1. **The image is not drawn below 52rem** (17.2), because at 390 px the image would add its height on top of the caption. This
   is the main protection of R9.5 at 390x844, where 120 px are left under the counts.
2. **The caption stays short.** At 390 px it is about 6 lines in 0.8125rem. A longer caption, or a larger type size, takes the
   120 px. Do not add a sentence to it, and do not enlarge it. The label is in a `span` on the same paragraph, not a second
   block with its own margin.
3. **The image is drawn with `max-width: 36rem` from 52rem up.** At its natural width the spare under the whole result at
   1280x800 is 104 px on the Mac and 66 px on Linux, which is enough but thin on a runner with a wider font. The limit keeps
   Kiro's words readable at about three quarters of their size and gives back about 30 px. If the person building the page still
   sees less than about 40 px, shrink the image further before touching the counts, the caveat or the size sentence. That is a
   layout choice, so no contract checks a size.
4. **The first-screen contracts still run.** `above-fold-v2.contract.test.js` (R9.5) is not revised. If the figure pushes
   the result out on a machine, that contract fails there, which is its job. The task report of task 35 gives the measured
   numbers for both windows, as tasks 27 and 29 did.
5. **The image is inline data.** The page makes no new request for it, so nothing can fail to load in CI and leave an empty
   box. The cost is 15.4 KB more in `index.html`.

### Where criteria seem to pull against each other (Nov 17)

- **10.3 "only `<img>`" and the old no-image checks.** 10.3 now allows one image where three checks forbade every `<img>`:
  `story.contract.test.js` R10.3, `test/site-story.test.js` (line 137) and `test/site-style.test.js` (line 204). All three
  are revised to allow exactly one `img`, from a `data:image/webp` source with non-empty alt text. They still ban `iframe`,
  `video`, `audio`, `embed`, `object`, `source`, `picture` and `style`. `look.contract.test.js` R8.2 already allows an `<img>`
  whose source is `data:`, so it passes unchanged.
- **10.4 "other code blocks keep wrapping" and the old `white-space` rule.** The frozen R10.4 refused `white-space: pre` or
  `nowrap` on any rule that styles `.demo`, and the three unit tests copied it. Both must go, because `.demo` is now the box
  of the demo command. The revised contract reads computed styles instead, so the ban is not lost: the one nowrap box is the
  demo command, and every other code element is checked to wrap.
- **17.3 "R9.5 still holds" and 17.1 "the caption is drawn" at 390x844.** The caption must be drawn at 390 px and R9.5 must
  hold there, and the caption costs height. They do not contradict (the table above leaves 99 px), but they leave a thin
  margin that depends on fonts. That is why the image, the biggest part, is not drawn on a phone and the caption is short.
- **17.2 "at least 52rem" and a contract with no sizes.** 17.4 allows checking whether the image is drawn at 1280x800 and
  at 390x844 only. The 52rem edge itself is therefore not tested at 831 and 832 px: that would pin a pixel size in the
  contract. The edge is the one number in `style.css` and the unit test of task 35 reads it from there.
- **10.3 "exactly one `img`" and task 34 (the R10.4 computed test).** The review asked the R10.4 computed test to assert that the
  settled page has exactly one `img`, so an image added by `app.js` counts against 10.3. Task 34 names 10.4, and 34 is done
  before 35 builds the one image, so "exactly one" there would keep 34 from ever being accepted. The two criteria cannot both
  be met as worded, so the R10.4 computed test asserts at most one, and a new R10.3 test, run with scripts on and settled at
  both sizes, asserts exactly one, in the figure, from a `data:image/webp` URL. Together they refuse an image added by the
  script, and only the R10.3 test waits for task 35.
- **"Drawn" and "visible".** 17.1 and 13.5 as revised say visible at every window width, so the contracts use one check
  (`shownInPage`): a client rect with a box, and for the element and every ancestor computed visibility `visible`, opacity
  `1`, clip `auto` and clip-path `none`, text that is not transparent, a box not drawn beside the page, and nothing cut off by
  the element's own box. It pins no number and no font size. The page's own `.sr-only` rules fail it (a box of one point with
  `overflow: hidden`).
- **The hash comparisons stay red until a person freezes.** The R13.9 lock test of `play-page.contract.test.js` compares
  `story`, `first-screen` and `first-screen-v3` with the lock's hashes. This revision changes those three files, so that
  one test is EXPECTED to fail until a person freezes `receipt-viewer` again. It is the review step, as the Nov 16 section
  says, and it passes from the freeze on without an edit. It does not list `kiro-session`, and it is not revised here.
- **The new contract file and 16.7.** `no-browser.contract.test.js` finds browser contract files by what they do (they read
  `process.env.CHROME_PATH`), so `kiro-session` and the revised `story` are found with no entry anywhere and it is not edited.
  Each skips with `cannot run: no Chrome or Chromium found (set CHROME_PATH)`, the same text as the other files, and the
  gate still counts a skip as failing.

### The contracts of Nov 17

| File | Tests |
|---|---|
| `kiro-session.contract.test.js` (new, drafts for a person to review) | R17.1 the figure is in the header after the line of 14.1 and before the real-use line, which still follows the header directly, with scripts off, and its box overlaps none of the heading, the line of 14.1 and the real-use line; R17.1 the caption is the quoted words in quotation marks and then the label, shown at both sizes; R17.2 and R17.4 one `img` in the figure, its alt text is the quoted words and equals the words the caption quotes; R17.2 the `src` is `data:image/webp;base64,` and decodes to exactly the bytes of `site/kiro-session-nov8.webp`, whose SHA-256 equals a constant in the contract; R17.2 shown at 1280x800 and not drawn at 390x844 with the caption still shown; R17.3 no link, control or media in the figure, no animation on the figure, inside it or around it, `animation-name` none on every ancestor and `transition-duration` 0s on the figure and everything in it; R17.4 the file pins no pixel size or position |
| `story.contract.test.js` (revised) | R10.1 the new heading sentence; R10.2 step 3 says "a receipt you can re-run" and not "anyone"; R10.3 exactly one `img`, `data:image/webp` source, non-empty alt, the other embeds still banned; R10.3 (new) the settled page has exactly one `img`, in the figure; R10.4 (static, renamed) no fixed width, and the ban on `white-space: pre` or `nowrap` is back for every rule that styles How it works except the demo command's own box, and for any rule that names a `pre` or `code` element; R10.4 (computed, revised) the demo command on one line in its own box at both sizes, every other `pre` and `code` drawn or not wraps, at most one `img`, and the page does not scroll sideways, read against `clientWidth` with `innerWidth` asserted equal to the width asked for |
| `first-screen-v3.contract.test.js` (revised) | the heading sentence in R14.1 (constant and the two heading checks); R9.5 at 390x844 and R12.1 assert that `innerWidth` is the width asked for |
| `first-screen.contract.test.js` (revised) | R11.2 at 1280x800 and at 390x844: delay plus duration at most 500 ms, no beat animation paused, a finite end time of at most 500 ms for each animation of a beat, and at 500 ms (animations paused, `currentTime` set) every beat is at opacity 1 with no transform and everything that holds the beats is at opacity 1; the reduce check is kept |
| `play-page.contract.test.js` (revised) | R13.5 reads the sentence before any press at 1280x800 and at 390x844 and requires it to be shown; the R13.9 control test and the R13.10 test at 390 assert that `innerWidth` is the width asked for |

Test names. Three tests are renamed and the rest keep their names: the static R10.4 test of `story` (its title said the page
wraps at phone width), the R17.3 test of `kiro-session` (new file) and the R10.5 test of `necro-core` `mcp.contract.test.js`.
A rename before a freeze is safe, and the reason is not a stale lock: `freezeSpec` records each contract file's names from the
run at freeze time (`src/lock.js`), so the lock takes the new names when a person freezes. Names matter to the gate for one
thing, the prefix: a task requires the contracts whose names start with its criteria, so a name must keep starting with its
criterion and a space. New tests (R10.3 settled, R10.4 computed, the new file) add names the same way.

### Requirement coverage (Nov 17)

| Criterion | Where | Task |
|---|---|---|
| 10.1, 14.1 | `index.html` (`h1`), `story`, `first-screen-v3` contracts | 34 |
| 10.2 | `index.html` (step 3), `story` contract | 34 |
| 10.4, 11.3 | `style.css` (`.demo`, `.try code`), `story` R10.4 computed test | 34 |
| 11.2 | `style.css` (`.beat` timing), `first-screen` R11.2 | 34 |
| 13.5 | `index.html` (`p.play-before`), `style.css` if needed, `play-page` R13.5 | 34 |
| 17.1, 17.2, 17.3, 17.4 | `index.html` (`figure`), `style.css` (`.intro`, `.session`), `kiro-session` contract | 35 |
| 10.3 | `index.html` (the one `img`), `story` R10.3 | 35 |
