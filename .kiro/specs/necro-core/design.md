# Design: necro-core

## Overview

`necro` is a zero-dependency Node.js CLI tool that brings Design by Contract to Kiro specs. It freezes a spec's
requirements and contract files so they cannot move during a task, gates the "task done" checkbox on those contracts
passing, and writes a content-addressed receipt for every task that passes. A Kiro hook file
(`.kiro/hooks/necromancer.json`, written by `necro init`) wires the tool into the agent's tool-use lifecycle.

The tool is built under its own gate: this repository has `contracts/necro-core/` and `.necro/` for itself.

## Architecture

```
                     bin/necro.js   (CLI entry: parse argv, dispatch)
                          │
        ┌────────┬────────┼────────┬─────────┐
        ▼        ▼        ▼        ▼         ▼
   src/lock  src/contracts  src/receipts  src/verify  src/hooks
        │        │              │             │          │
        └────────┴──────┬───────┘             │          │
                        ▼                     │          │
                   src/canon.js ───────────────┴──────────┘
                  (canonicalJson, sha256)

  necro freeze <spec>      → lock.freezeSpec   → .necro/lock.json + .necro/frozen/
  necro verify <receipt>   → verify.verify     → reads .necro/receipts/<spec>/
  necro init               → templates/         → .kiro/hooks/ + .kiro/steering/
  necro hook pre|post|stop → hooks.handle*      → reads .necro/lock.json
```

Data flow:

- **Freeze**: reads `requirements.md` and `contracts/<spec>/*.contract.test.js`, hashes each, writes
  `.necro/lock.json` and copies each file to `.necro/frozen/<sha256>`.
- **PreToolUse hook**: reads `.necro/lock.json`. Blocks edits to frozen files and `.necro/`. If a `tasks.md` edit
  marks a task done, runs frozen contracts; on success writes a receipt and allows the edit.
- **PostToolUse hook**: after `execute_bash`, re-hashes frozen files; restores any that changed from
  `.necro/frozen/`.
- **Stop hook**: prints a per-spec summary (tasks done, receipts, failing contracts).
- **Verify**: loads a receipt, re-hashes every file it pins, re-runs contracts, compares results.

## Modules

All modules are ES modules using only Node built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`,
`node:test`, `node:assert`). Each has a unit test in `test/`. The list mirrors `structure.md`.

| Module | Path | Responsibility | Key exports |
|---|---|---|---|
| Canonical JSON & hashing | `src/canon.js` | Deterministic JSON serialization and SHA-256 hashing (Req 1). | `canonicalJson(value)`, `sha256(textOrBytes)`, `hashFile(filePath)` |
| Lock file | `src/lock.js` | Freeze, read, and query `.necro/lock.json`; manage `.necro/frozen/` copies (Req 2, 3). | `readLock(cwd)`, `writeLock(cwd, lock)`, `freezeSpec(cwd, spec)`, `isSpecFrozen(cwd, spec)`, `isFrozenPath(cwd, path)`, `frozenFiles(cwd, spec)`, `getExpectedHash(cwd, path)` |
| Contracts runner | `src/contracts.js` | Run frozen contracts with `node --test` and report pass/fail by name (supports Req 4.4, 4.5, 6). | `runContracts(cwd, spec, lock)` → `[{ name, path, sha256, result }]` |
| Receipts | `src/receipts.js` | Build, hash, and write receipts; trace contract imports to pin source files (Req 5). | `traceImports(cwd, filePath)`, `buildReceipt(cwd, spec, lock, results)`, `computeReceiptHash(receipt)`, `writeReceipt(cwd, spec, receipt)` |
| Hook handlers | `src/hooks.js` | PreToolUse (block + gate), PostToolUse (restore), Stop (summary) (Req 3, 4, 7). | `handlePreToolUse(payload)`, `handlePostToolUse(payload)`, `handleStop(payload)` |
| Verify | `src/verify.js` | Re-run a receipt and confirm or report mismatches (Req 6). | `verify(cwd, receiptFile)` → prints CONFIRMED / MISMATCH, returns exit code |
| CLI entry | `bin/necro.js` | Parse argv and dispatch to subcommands. | `main(argv)` |

### Dependency graph

```
canon.js        ← foundation, no deps
lock.js         ← depends on canon
contracts.js    ← depends on canon
receipts.js     ← depends on canon, contracts
hooks.js        ← depends on canon, lock, contracts, receipts
verify.js       ← depends on canon, contracts, receipts
bin/necro.js    ← depends on all of the above
```

## Data formats

All paths stored in data files are relative to the project root and use forward slashes.

### .necro/lock.json

Pretty-printed JSON (2-space indent). Object keys are inserted in sorted order for clean git diffs. The `frozenAt`
field is a convenience timestamp; it is never a hash input.

```json
{
  "specs": {
    "necro-core": {
      "frozenAt": "2026-11-06T12:00:00.000Z",
      "requirements": {
        "path": ".kiro/specs/necro-core/requirements.md",
        "sha256": "a1b2c3d4e5f6..."
      },
      "contracts": [
        {
          "name": "canon",
          "path": "contracts/necro-core/canon.contract.test.js",
          "sha256": "d4e5f6a7b8c9..."
        }
      ]
    }
  }
}
```

- `specs[<spec>].requirements`: the frozen requirements file path and hash.
- `specs[<spec>].contracts`: array of frozen contract files. `name` is the filename stem (strip
  `.contract.test.js`).
- Re-freezing a spec replaces `specs[<spec>]` and leaves other specs' entries unchanged (Req 2.4).

### .necro/frozen/

Content-addressed copies of frozen files. Each file is stored at `.necro/frozen/<sha256>` as raw bytes (the exact file
content). Two files with the same content share one copy. The PostToolUse handler restores from here.

### Receipts: .necro/receipts/<spec>/<receiptHash>.json

Pretty-printed JSON. Written when all contracts pass during the gate.

```json
{
  "spec": "necro-core",
  "gitCommit": "f9a8b7c6d5e4...",
  "requirements": {
    "path": ".kiro/specs/necro-core/requirements.md",
    "sha256": "a1b2c3d4e5f6..."
  },
  "contracts": [
    {
      "name": "canon",
      "path": "contracts/necro-core/canon.contract.test.js",
      "sha256": "d4e5f6a7b8c9...",
      "result": "pass"
    }
  ],
  "sources": [
    {
      "path": "src/canon.js",
      "sha256": "7g8h9i0j1k2..."
    }
  ],
  "receiptHash": "x1y2z3w4v5u6...",
  "createdAt": "2026-11-06T12:01:00.000Z"
}
```

- `gitCommit`: output of `git rev-parse HEAD` from `cwd`, or `null` if not in a git repo.
- `uncommitted`: present only when `gitCommit` is set (Req 5.4). The sorted, unique list of pinned paths
  (requirements, contracts, sources) whose SHA-256 differs from that file at `gitCommit` (`git show <commit>:./<path>`),
  or that the commit lacks. `[]` when every pinned file matches the commit. It is part of `receiptHash`.
- `sources`: every project source file transitively imported by the contract files, excluding the contract files
  themselves (already listed under `contracts`) and excluding `node:` builtins. Each entry is unique (deduplicated).
- `result`: `"pass"` or `"fail"` per contract.
- `receiptHash`: `sha256(canonicalJson(receiptWithoutHashAndCreatedAt))`: the SHA-256 of the canonical JSON of the
  receipt object with the `receiptHash` and `createdAt` fields removed (Req 5.2).
- `createdAt`: ISO 8601 UTC timestamp, added after the hash is computed.

Because `receiptHash` is derived from all other fields (minus `createdAt`), two receipts from identical inputs produce
the same `receiptHash` (Req 5.3).

### .necro/ directory layout

```
.necro/
  lock.json
  frozen/
    <sha256>              # raw file content (requirements + contracts)
  receipts/
    <spec>/
      <receiptHash>.json
```

## Hook STDIN handling

Hooks are registered in `.kiro/hooks/necromancer.json` (written by `necro init`). Each hook calls
`necro hook <subcommand>`, which reads a JSON payload from STDIN and responds with an exit code.

### Payload

The hook command receives a JSON object on STDIN with these fields:

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Unique session identifier. |
| `hook_event_name` | string | Event that fired: `PreToolUse`, `PostToolUse`, or `Stop`. |
| `cwd` | string | Project root directory. Used to locate `.necro/lock.json` and resolve relative paths. |
| `tool_name` | string | The tool being called (`fs_write`, `str_replace`, `execute_bash`). Absent for `Stop`. |
| `tool_input` | object | The tool's parameters. Shape depends on `tool_name`. |

`tool_input` shapes:

| `tool_name` | `tool_input` fields |
|---|---|
| `fs_write` | `path` (string), `text` (string) |
| `str_replace` | `path` (string), `oldStr` (string), `newStr` (string) |
| `execute_bash` | `command` (string) |

Example PreToolUse payload (`fs_write`):

```json
{
  "session_id": "s-001",
  "hook_event_name": "PreToolUse",
  "cwd": "/home/dev/project",
  "tool_name": "fs_write",
  "tool_input": {
    "path": "/home/dev/project/contracts/necro-core/canon.contract.test.js",
    "text": "..."
  }
}
```

Example PostToolUse payload (`execute_bash`):

```json
{
  "session_id": "s-001",
  "hook_event_name": "PostToolUse",
  "cwd": "/home/dev/project",
  "tool_name": "execute_bash",
  "tool_input": {
    "command": "sed -i 's/foo/bar/' src/canon.js"
  }
}
```

### Path resolution

`tool_input.path` may be absolute or relative. The handler:

1. If absolute, use as-is. If relative, join with `cwd`.
2. Compute the project-relative path: `path.relative(cwd, resolved)` normalized to forward slashes.
3. Compare the project-relative path against lock entries (which are also project-relative with forward slashes).

The `.necro/` block check: the project-relative path starts with `.necro/` (or equals `.necro`).

### Exit codes

| Exit code | Meaning | Effect |
|---|---|---|
| 0 | Allow | The tool call proceeds (PreToolUse) or the handler finishes (PostToolUse / Stop). |
| 2 | Block | For PreToolUse, the tool call is blocked and **stderr is shown to the agent**. |

All user-facing messages are short plain sentences that say what to do next (per tech rules).

### PreToolUse flow

`necro hook pre`: no matcher, so it runs for every tool (Req 8.4); the handler allows read-only tools itself.

```
Read STDIN → parse JSON → resolve path (project-relative)
│
├─ path under .necro/?
│    YES → exit 2, stderr: "Cannot edit files under .necro/. These are managed by necro."
│
├─ path is a frozen file (in lock)?
│    YES → exit 2, stderr: "Cannot edit frozen file <path>. Fix the code, not the contract."
│
├─ path is .kiro/specs/<spec>/tasks.md and more [x] marks than before?
│    YES (task being marked done) → GATE:
│       ├─ spec not frozen? → exit 2, stderr: "Spec '<spec>' is not frozen. Run 'necro freeze <spec>' first."
│       ├─ run frozen contracts (node --test per contract)
│       ├─ any contract fails? → exit 2, stderr: "Contracts failed: <name1>, <name2>."
│       └─ all pass? → write receipt to .necro/receipts/<spec>/<hash>.json → exit 0
│
└─ otherwise → exit 0 (silent)
```

Task-done detection:

- `str_replace` on `tasks.md`: count `[x]` (case-insensitive) occurrences in `newStr` vs `oldStr`. More in `newStr` =
  marking done (Req 4.1).
- `fs_write` on `tasks.md`: count `[x]` in `tool_input.text` vs the current file on disk. More in the new text =
  marking done (Req 4.2).

### PostToolUse flow

`necro hook post`: matcher: `execute_bash`.

```
Read STDIN → parse JSON → read lock
│
└─ for each frozen file (requirements + contracts):
     compute current sha256
     differs from lock hash?
       YES → copy .necro/frozen/<lockHash> back to the original path
              write to stderr: "Restored frozen file <path> after shell command."
│
└─ exit 0
```

### Stop flow

`necro hook stop`: no matcher.

```
Read STDIN → parse JSON → read lock
│
└─ for each frozen spec:
     count [x] marks in .kiro/specs/<spec>/tasks.md (0 if missing)
     count receipt files in .necro/receipts/<spec>/ (0 if missing)
     run contracts, collect failing contract names
     print: "Spec <spec>: <n> tasks done, <m> receipts, <passing | failing: name1, name2>."
│
└─ exit 0
```

## Key algorithms

### Canonical JSON and hashing (Req 1)

- `canonicalJson(value)`: recursively sort object keys, serialize with `JSON.stringify` using no replacer and no
  indent. Arrays keep their order. UTF-8.
- `sha256(textOrBytes)`: if string, encode UTF-8; compute SHA-256; return 64 lowercase hex characters.
- `hashFile(filePath)`: read file bytes, `sha256(bytes)`.
- Same value with keys in different orders → same canonical text → same hash.

### Import tracing for receipts (Req 5.1)

To find "each project source file the contracts import":

1. Start from each contract file in the lock.
2. Read the file, find `import ... from '<relative>'` and `require('<relative>')` statements via regex.
3. For each relative specifier (starts with `./` or `../`):
   - Resolve relative to the importing file's directory.
   - Try the exact path, then append `.js`, `.mjs`, `.cjs`, or `/index.js`.
   - If the file exists and is not already visited, add it and recurse into it.
4. Skip `node:` builtins and bare specifiers (no `./` or `../` prefix).
5. Skip paths already in the `contracts` list (they have their own hash entries).
6. Deduplicate. Return the sorted list of source paths with their hashes.

### Gate flow (Req 4)

Triggered by PreToolUse when a `tasks.md` edit increases the `[x]` count:

1. Derive spec name from the tasks.md path (`.kiro/specs/<spec>/tasks.md` → `<spec>`).
2. Check `isSpecFrozen(cwd, spec)`. If not → exit 2 with a freeze instruction.
3. `runContracts(cwd, spec, lock)`: run each frozen contract with `node --test <file>`, collect pass/fail by name.
4. If any `result === "fail"` → exit 2, list failing contract names on stderr.
5. If all pass → `buildReceipt` (trace imports, hash all inputs, compute receiptHash) → `writeReceipt` → exit 0.

## Error messages

All errors are short plain sentences that say what to do next:

| Condition | Message |
|---|---|
| No contract files for spec (freeze) | "No contracts found for spec '<spec>'. Add at least one file in contracts/<spec>/." |
| PreToolUse blocks frozen file edit | "Cannot edit frozen file <path>. Fix the code, not the contract." |
| PreToolUse blocks .necro/ edit | "Cannot edit files under .necro/. These are managed by necro." |
| Gate: spec not frozen | "Spec '<spec>' is not frozen. Run 'necro freeze <spec>' first." |
| Gate: contracts failed | "Contracts failed: <name1>, <name2>." |
| Init: files already exist | "Necromancer hook and steering files already exist. Left unchanged." |
| Verify: file mismatch | "MISMATCH. Files changed: <path1>, <path2>." |
| Verify: contract mismatch | "MISMATCH. Contracts changed: <name1>, <name2>." |
| Verify: confirmed | "CONFIRMED <receiptHash>." |

## Templates (init)

`necro init` copies from `templates/`:

- `templates/necromancer.hooks.json` → `.kiro/hooks/necromancer.json`: PreToolUse (no `matcher` field, which Kiro
  treats as every tool; `*` is not a valid regular expression, so it is not used), PostToolUse (matcher `execute_bash`), and Stop hooks, each calling
  `necro hook pre` / `necro hook post` / `necro hook stop` with a 300-second timeout.
- `templates/necromancer.steering.md` → `.kiro/steering/necromancer.md`: tells the agent that frozen contracts
  decide "done" and must not be edited.

If either target file already exists, it is left unchanged and the user is told (Req 8.3).

`necro` must be installed and on PATH for the hooks to fire. The `package.json` `bin` field maps `necro` to
`bin/necro.js`.

## Clarification (contracts are named tests)
A contract is one named `node:test` test inside a contract file. `runContracts` runs each file through the `node:test`
`run()` API in a small child process (`src/contract-runner.js`) and builds results from the `test:pass` and `test:fail`
events, never from text the code under test can print (Req 4.12). It returns one result per test:
`{ name, path, sha256, result }`. Skipped and todo tests, and suites that threw or were skipped, count as failing. An
event at nesting 0 whose name is the contract file's own path is the runner's report on the file: a failing one (load
error, non-zero exit) makes the file one failing contract named after the file, and a file with no tests does the same.
Recorded names are matched per contract file. Receipts and verify compare results by contract name.

## Clarification (shell ticks, Req 3.7)
The gate keeps the last `tasks.md` it saw for each frozen spec in `.necro/state/<spec>.tasks.md`. It records the file
when an allowed `fs_write` or `str_replace` changes it, and before an `execute_bash` call when nothing is recorded yet.
After `execute_bash`, a task that became `[x]` since the recorded state triggers a contract run. If any contract fails,
`tasks.md` is written back from the recorded state. With no recorded state the baseline is the current file with every
task unticked.

## Clarification (state the shell cannot forge, Req 3.8 to 3.11)
Before every `execute_bash` call, PreToolUse records each frozen spec's current `tasks.md` in
`.necro/state/<spec>.tasks.md`, replacing any earlier record, and writes the record's SHA-256 next to it. After the
call, PostToolUse trusts the record only if its hash still matches. A record that is missing or changed makes the
baseline the current file with every task unticked, so every `[x]` line is checked as newly ticked. PreToolUse no
longer records anything for `fs_write` or `str_replace`. PostToolUse runs after those tools too (the hook template
matches `execute_bash|fs_write|str_replace`) and records `tasks.md` of a frozen spec as it is on disk once the write
has landed. A command that rewrites both the record and its hash is not detected; the README states this limit.

A non-read-only tool call is blocked when a string in its input is longer than 4096 characters or contains a NUL
character. The content fields of `fs_write` and `str_replace` and the `command` of `execute_bash` are not paths and
are exempt, so large files and long shell commands still go through.

## Clarification (protected paths, Req 3.5 and 3.6)
A tool path is resolved the way the operating system would (links followed, including links in the middle of the path
and links to files that do not exist yet; the nearest existing parent for a new file) and compared with `.necro/` and
the frozen paths ignoring letter case and Unicode normal form. Every tool other than the read tools (`read_file`,
`list_directory`, `file_search`, `grep_search`, and the CLI 2.x names `grep` and `glob`) is blocked when any string in
its input names a protected path, so `code` and unknown tools are blocked. For `fs_write`, `str_replace` and
`fs_append` the `text`, `oldStr` and `newStr` fields are file content and are not checked as paths. `delete_file`
names its file in `targetFile`, which is checked like any path.

## Clarification (Kiro's tool names, Req 3.12, 3.13, 8.5)
All four Kiro shell tools (`execute_bash`, `execute_pwsh`, `control_bash_process`, `control_pwsh_process`) get the
`execute_bash` treatment: PreToolUse records the task state, PostToolUse restores frozen files and checks ticks, and
the `command` field is exempt from the length and NUL check. `fs_append` and `delete_file` are write tools for
`tasks.md`. An `fs_append` is gated on the file it would produce (the disk file, a newline if it does not end with
one, then the text); a `delete_file` ticks nothing. PostToolUse records the state after all four write tools. The
PostToolUse matcher in `templates/necromancer.hooks.json` lists every shell tool and every write tool.

## Clarification (fail closed on ticks, strict verify, Req 4.13 and 6.7)
A task line is an optional list marker followed by a checkbox, so `[x] text` without a marker counts. A write to
`tasks.md` is a tick when the resulting file has more `[x]` task lines than the file on disk (a missing file counts as
zero) or a `[x]` line the disk file does not have. A `str_replace` that does not apply to the disk file is compared by
the number of `[x]` marks in `oldStr` and `newStr`.

`verify` treats a lock file that exists as binding: the receipt's spec must be in it, its contract files, hashes and
names must equal the lock's (compared per file, none missing, none extra), and the lock's contracts are the ones run.
Results are compared by file and name.

## Clarification (the Kiro IDE's task tool, Req 4.19 and 4.20)
The IDE marks spec tasks done with `task_update`, whose input is `{ tasksFilePath, taskId, status, error }`. `taskId` is
the task line text after the checkbox. PreToolUse gates the call only when `status` is `completed` (any letter case);
`in_progress`, `queued` and `task_list` are allowed silently. The hook does not edit `tasks.md`. It reads the file on
disk, finds the lines whose text equals `taskId`, and runs the same gate as for a tick written to the file, with that
text as the ticked task and the disk file with the line ticked as the state after. A `taskId` that matches no line
ticks nothing, so every contract is required and the receipt's `task` is `null`. A `tasksFilePath` that resolves
outside the project, or that is not `.kiro/specs/<spec>/tasks.md`, names no spec, so the call is blocked with a short
message.

## Clarification (a confirmed receipt that records failures, Req 6.11 and 6.12)
`necro check` writes a receipt even when a contract fails (Req 9.2), and `verify` confirms a receipt when the re-run
gives the same results, so a receipt that records a failure can print CONFIRMED. That is true but easy to misread as
"the contracts pass". After `CONFIRMED <receiptHash>.`, `verify` therefore looks at the receipt's own `contracts` list.
Once the checks above have passed, the re-run agrees with that list entry by entry, so it is the list to report. Every
entry whose `result` is not `pass` is a failing contract.

- With none, `verify` prints nothing more, so the output for a passing receipt is the single line it always was (6.12).
- With one or more, it prints on the next line `This receipt records N failing contracts: <names>.`, or
  `This receipt records 1 failing contract: <name>.` for one. Names are joined with `, ` like the paths and names in
  the other `verify` messages, and keep the order of the receipt's `contracts` list, not a sorted order.
- The exit code stays 0. The line is information about a receipt that is true, not a mismatch. `MISMATCH`,
  `SUPERSEDED` and the altered-receipt message are unchanged and print no such line.

The change is a few lines at the end of `verify` in `src/verify.js`. It adds no module and no receipt field, so
`receiptHash` and every existing receipt are unaffected.

## Clarification (honest verify outcomes, Req 6.13 to 6.16)
`necro verify` now has five outcomes: CONFIRMED (exit 0), MISMATCH (exit 1), SUPERSEDED (exit 1), INCOMPLETE (exit 2)
and OTHER PROJECT (exit 2). Exit 2 means "no verdict about the code": the check could not be made here. Exit 1 means
the receipt does not describe today's code. All changes are in `src/verify.js`, plus a small helper in
`src/contracts.js` or `src/runners.js` if the re-run must report which contracts could not run.

**A contract that cannot run versus a changed one (6.13).** Two causes count as "not run": the runner is not installed,
or a module the contract imports is not installed (a fresh clone before `npm ci`). The runner code already marks a
result `cannotRun` when the program is not found (`ENOENT`) or the standard error of a command without a report says a
module is missing (`missingFromStderr` in `src/runners.js`), and `check` and `audit` already use that mark. `verify`
ignores it today, so a contract that did not run looks like a result that differs, and prints `MISMATCH. Contracts
changed`. The re-run in `verify` therefore keeps the mark. The comparison of re-run results with the receipt skips every
contract that has `cannotRun` and collects it in a list instead. File hashes, lock checks, contract names and
frozen-glob drift are compared first, exactly as now, so a real change still ends in `MISMATCH` even when a module or
runner is missing. Only when all of those match, and every contract that did run agrees with the receipt, and the list
is not empty, does `verify` print `INCOMPLETE` and return 2.

*How a missing imported module is detected.* Today the mark is set only for a command with no report. Two more places
must set it, using the same `missingFromStderr` wording so every cause reads the same:
- A Node contract goes through `src/contract-runner.js`. When its import fails to load, `interpret` in
  `src/contracts.js` returns one failing contract named after the file, with `fileFailure` and `loadFailure` set and the
  first lines of the error in `errorLines`. Node's message for an uninstalled package is `Cannot find package 'x'
  imported from ...` with code `ERR_MODULE_NOT_FOUND`. When `loadFailure` is set and `errorLines` match
  `ERR_MODULE_NOT_FOUND` or `Cannot find package '<name>'` with a bare package name (not a path starting with `.` or
  `/`, which is the project's own file and a real failure), the result gets `cannotRun`. Because a file that never
  loaded reports none of its recorded contract names, each recorded name the run did not report (the stale-lock branch in
  `runContracts`) takes the file's `cannotRun` the way the runner-file branch already does, so the receipt's names are
  compared as "not run", not as "missing from the lock".
- A Python contract run by a command (`pytest`) that exits non-zero still writes a report, and a test file that imports
  a missing module gives an error case whose text holds `ModuleNotFoundError: No module named 'x'`. `runReport` checks
  the standard error and the error text of the report cases with the Python pattern of `missingFromStderr`. It sets
  `cannotRun` only for a module other than the runner (`pytest` itself missing is already covered by the same pattern and
  reads the same). A report that holds other failures or an assertion failure is not changed by this: a contract that
  ran and failed is a result, never "not run".

*Telling the cases apart.* A contract is "not run" only when its output has no result because of a missing program or
module. A contract that ran and failed (an assertion failure, a thrown error in a test body, a syntax error, a path
import that does not exist) keeps `cannotRun` unset and compares as a differing result. A contract whose own file hash
differs from the receipt is a change whatever the import says. So the order is: pinned file hashes and names first,
then results of contracts that ran, then the not-run list.

*The message.* `INCOMPLETE` names each contract that did not run, what is missing as a short phrase ending in "not
found", and the usual fix in parentheses:
- Missing program (`ENOENT`): `pytest not found (install pytest)`.
- Missing Node package: `<package> not found (run npm ci)`, for example `necro-fake-dep not found (run npm ci)`.
- Missing Python module: `<module> not found (pip install <module>)`, for example `requests not found (pip install
  requests)`. For `pytest` itself the module is `pytest`, so the phrase is `pytest not found (pip install pytest)`.
The missing item is the module name Node or Python reports. Phrases are listed once per contract and the list keeps the
receipt's order. The exit code stays 2 and `MISMATCH` is never printed when the only difference is what did not run.
A contract that ran and differs from the receipt is still a change: with both a changed contract and a missing module or
runner the answer is `MISMATCH`.

**Newer receipt under the same freeze (6.14).** The check applies only where `verify` would print `MISMATCH` because
pinned files or contract results differ (the "Files changed" and "Contracts changed" branches). It does not apply to an
altered receipt hash, to a missing spec in the lock, to a receipt without requirements or contracts, or to any
difference between the receipt's requirement and contract hashes and the lock's, and 6.8 keeps handling a spec that was
frozen again. It applies only when the receipt's requirements and contract hashes (and runners and frozen files) equal
the lock's. The candidates are the other receipts in `.necro/receipts/<spec>/`. The order is the `createdAt` each
receipt wrote itself, not the file's modification time (which a copy or a checkout changes). `createdAt` is not part of
the receipt hash, so a candidate must be strictly later than the receipt being verified, and a receipt without a
readable `createdAt` is never a candidate. Because `createdAt` is outside the receipt hash, a wrong date can only change which receipt is named. It can never turn a real change into SUPERSEDED, because that still needs a newer receipt that verifies today. Candidates are tried newest first. A candidate counts when verifying it
gives CONFIRMED today, which includes the altered-hash check. The first one that does is named in the SUPERSEDED
message by its path, with the sentence that later work under the same freeze changed the code or the results, and
`verify` returns 1.

To avoid recursion, `verify` is split into an inner function that takes an option `allowNewer` and the public `verify`
that calls it with `allowNewer: true`. When the inner function checks a candidate it calls the same inner function with
`allowNewer: false` and with printing turned off, so a candidate never looks for its own newer receipt. Each candidate
is also strictly later than the one before it in the chain, so the search ends after one pass over the folder even
without the option. The candidate's run prints nothing, and its exit code decides. No candidate that is not CONFIRMED
changes the answer, so the result is `MISMATCH` as before. A run that finds no candidate costs one directory read.

**A newer receipt that is only partly checkable here (6.14, INCOMPLETE).** A newer receipt can be the right answer
for the older one even when this machine cannot run all of its contracts (a fresh clone with no `pytest`, or before
`npm ci`). The inner function of `verify` therefore returns a small result instead of only a number: `{ code, notRun }`,
where `code` is 0 (CONFIRMED), 1, or 2 (INCOMPLETE) and `notRun` is the list `{ name, missing, fix }` that 6.13 already
collects, in the receipt's order. The candidate check runs with `allowNewer: false` and with printing off, so a candidate
reports nothing itself. The outcomes of a candidate are read like this:
- `code` 0: CONFIRMED. The candidate counts.
- `code` 2 with a non-empty `notRun`: INCOMPLETE. Every file hash, lock check, contract name and every contract that
  did run agree with today, and only the contracts in `notRun` could not be run. The candidate counts, because it is the
  newer receipt that describes today's code as far as this machine can see.
- Anything else (`MISMATCH`, an altered hash, `SUPERSEDED`, `OTHER PROJECT`): the candidate does not count. A tampered
  or changed newer receipt never makes an older one `SUPERSEDED`.
Candidates are still tried newest first and the first one that counts is used, so a newer INCOMPLETE receipt is chosen
before an older CONFIRMED one. The older receipt must itself reach the "Files changed" or "Contracts changed" branch with
requirement and contract hashes equal to the lock's, as before; the older receipt's own contracts that cannot run are
skipped by 6.13 first, so a differing contract result of one that did run still counts as a difference. "Contract results
differ" in 6.14 therefore needs no extra code: two receipts under one freeze with the same lock hashes whose recorded
results differ (for example a contract that reads a file no receipt pins) take the "Contracts changed" branch, and a
CONFIRMED newer receipt turns it into `SUPERSEDED`.

The message for a CONFIRMED candidate is unchanged. For an INCOMPLETE candidate one sentence is added after the usual
one, naming each contract in `notRun` with what is missing and the fix, the way 6.13 words them:
`SUPERSEDED. Receipt <older path> was replaced by <newer path>: later work under the same freeze changed the code or the results. The newer receipt could only be partly checked on this machine: <name> (<missing>; <fix>)[, <name> (...)].`
for example `... could only be partly checked on this machine: R6.13 python criterion holds (pytest not found; install pytest).`
The exit code is 1, as for every `SUPERSEDED`, not 2: the older receipt is the one being judged, and it does not describe
today's code. `OTHER PROJECT` and `INCOMPLETE` of the receipt that was asked about are not changed by this.

**A spec of another project (6.15).** When a lock exists and the receipt's spec is not in it, `verify` looks for the
spec in the project: the folder `.kiro/specs/<spec>/` or `contracts/<spec>/`. If either exists, the spec belongs to this
project and is merely not frozen, so the current message stays (`MISMATCH. Spec '<spec>' is not in the lock...`, exit
1). If neither exists, the receipt was written elsewhere and `verify` prints
`OTHER PROJECT. Spec '<spec>' is not in this project. This receipt was written in another project; verify it from that project's checkout.`
and returns 2. When no lock file exists, nothing changes: the receipt's own pins are used as before.

**The gate counts a contract that cannot run as failing (6.16).** Only `verify` has an outcome for "not run". Every
other path treats a contract that cannot run as a failing contract. This is what the code does today, read from
`src/check.js`, `src/hooks.js` and `src/audit.js`:
- `runContracts` gives every contract that cannot run a result of `fail`, with the mark `cannotRun` as an extra field
  (`src/runners.js` sets it, `src/contracts.js` copies it to the file's recorded names). The mark is information, never a
  result. `failingRequired` in `src/audit.js` and `decideTicks` in `src/hooks.js` read only `result === 'fail'` and never
  look at `cannotRun`, so the gate already refuses the tick for PreToolUse (a write to `tasks.md` or `task_update`),
  PostToolUse (the shell tick check restores the file) and the verdict of Stop and PostTaskExec (`auditSpec` gives
  `CANNOT_RUN`, which `problems` lists as not ok, so `undoUnsupportedTicks` unticks the task). `necro check` also
  exits 1, because it counts every result that is not `pass`. So the tick is refused today, and no code has to decide that
  again. What the contracts of 6.16 pin is that this stays true when 6.13 is built: the `cannotRun` mark that task 42 adds
  for a missing Node package or Python module must be skipped only inside `src/verify.js`, never in `runContracts`,
  `failingRequired`, `decideTicks`, `auditSpec` or `checkSpec`.
- What is not true today is the second half of 6.16, naming what is missing, on the gate's refusal. The message of
  PreToolUse and PostToolUse is `failedMessage(failing, reasons)`, and the `reasons` are the `reason` texts of the failing
  results. For a runner that is not installed that text is `The command for test_a.py could not start (ENOENT). Check the
  command in runners.json.`, which does not name the program; the phrase that does, `the program pytest was not found`,
  sits in `cannotRun` and only `check` (when every failure cannot run), `audit` and Stop/PostTaskExec print it. A missing
  Node package or Python module already appears in the reason (the first lines of the load error or the standard error
  tail), so those cases name it today; task 42 will also set `cannotRun` for them.
- What must change, in `src/hooks.js` only: `decideTicks` also returns `missing`, the distinct `cannotRun` phrases of the
  failing required results, and `failedMessage` appends `The contracts cannot run here: <phrases>. Install or fix it, then
  tick the task again.` when `missing` is not empty. This covers PreToolUse, `task_update` and PostToolUse, which all
  call `failedMessage`. A real failure and a missing runner together stay one refusal that lists both. In `src/check.js`
  the line `The contracts cannot run here: ...` is printed only when every failure cannot run; with a mix it must be added
  too, before the line that says how many contracts failed, so what is missing is named whenever it is part of the
  failure. In `src/audit.js` the verdict stays `CANNOT_RUN` only when every failing contract cannot run, and `FAILING`
  otherwise; the `FAILING` reason then also lists the missing phrases of the failing contracts that cannot run, so the
  Stop and PostTaskExec undo message names them in the mixed case as well. Nothing is skipped and no exit code changes.
- The Stop summary line (`failing: <names>`) lists the contracts by name and is not the refusal, so it stays as it is.

**Exit codes.** CONFIRMED 0, MISMATCH 1, SUPERSEDED 1 (both 6.8 and 6.14), INCOMPLETE 2, OTHER PROJECT 2. `bin/necro.js`
already passes the returned number to the process exit.

**Wording of the five outcomes.** Requirement 10.2 lists the five outcomes. The `necro_verify` description in
`src/mcp.js` (today "CONFIRMED, MISMATCH or SUPERSEDED") must name CONFIRMED, MISMATCH, SUPERSEDED, INCOMPLETE and
OTHER PROJECT. Every line in the README and in `docs/` that lists what `necro verify` prints must name all five, with
the exit codes where the line gives codes. No new field is added to any receipt, so `receiptHash` and every existing
receipt are unaffected.
