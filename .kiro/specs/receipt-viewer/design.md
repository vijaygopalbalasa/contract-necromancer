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
