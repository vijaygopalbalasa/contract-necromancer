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
