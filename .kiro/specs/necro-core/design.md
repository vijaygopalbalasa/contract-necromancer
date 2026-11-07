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
