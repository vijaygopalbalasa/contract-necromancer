# Contracts for necro-core

Draft contracts for `.kiro/specs/necro-core/requirements.md`. Every one of them passes against the current code. A person
reviews them and runs `necro freeze necro-core`. After that, nobody edits them during a task.

Each test name starts with its criterion (`R4.14 `, with a space), because `requiredNames` in `src/lock.js` matches a
task's criteria to contract names with `n === 'R<c>' || n.startsWith('R<c> ')`. There is one test per criterion, 73 in
total, and every task in `tasks.md` names criteria that have a contract.

## How the files are written

- Only `node:test` and `node:assert` check anything. `node:fs`, `node:os`, `node:path`, `node:crypto` and
  `node:child_process` build temp projects, hash, and start `bin/necro.js` and `git`.
- Every test builds its own project in a temp directory and runs the tool there. Nothing touches this repository's
  `.necro/`, `.kiro/` or `contracts/`.
- Each file carries its own copy of the helpers it needs (`temp`, `put`, `necro`, `hook`, `freeze`). There is no shared
  helper file, because a helper that is not frozen could be edited during a task. The fixtures are copied from `test/`
  and extended; nothing is read from `test/`.
- Hooks are tested the way Kiro calls them: `necro hook pre|post|stop` with a JSON payload on stdin, and the exit code,
  stdout and stderr read back. A block is checked as exit 2 with a reason that is not `Hook error` (a crash also exits 2).
- `src/` modules that a file calls directly (`canon.js`, `contracts.js`) are imported. Everything else is reached
  through `bin/necro.js`, which a receipt would not pin by import. Each file therefore names the modules it exercises in a
  comment of the form `from '../../src/x.js'`. `src/receipts.js` pins whatever `from '...'` text it finds, comments
  included, so the receipt's `sources` hold the whole tool. Keep those comments.
- The test runner sets `NODE_TEST_*` variables for a contract file. Every helper that starts `necro` removes them first,
  so the nested run is not mistaken for part of the outer one. `receipts.contract.test.js` also removes `GIT_*`.
- Run time: about 6 seconds with `node --test contracts/necro-core/*.contract.test.js`, and about 30 seconds through
  `necro freeze`, `check`, `verify` or a gate, because necro runs the files one after another.

## What the contracts rely on

- `git` on the PATH (R5.1 and R5.4 make temp repositories).
- Symbolic links (R2.6, R3.5, R4.20).
- `/bin/sh` (R8.6 runs the written hook commands with an empty PATH).
- Lock format fields that the design describes only in part: `contracts[].names`, `tasks[id].criteria` and
  `tasks[id].text` (R2.5, R2.7, R2.8). R2.5 only requires each contract name to appear inside its own file's lock entry.
- The state file `.necro/state/<spec>.tasks.md` (R3.9), named in `design.md`. Behavior is checked, not the file's
  contents, except that R3.9 edits and deletes it.
- Messages: `Contracts failed: <names>.` for a refusal, `not frozen` plus `necro freeze <spec>`, `CONFIRMED <hash>`,
  `MISMATCH`, the `Spec <name>: <n> tasks done, <m> receipts, passing|failing: ...` line, and `pass <name>` / `fail <name>`
  lines from `necro check`. The wording of the other messages is left free.

## Contracts (one test per criterion)

| Criterion | File | What the test checks |
|---|---|---|
| R1.1 | `canon` | `canonicalJson` sorts keys recursively, keeps array order, has no whitespace outside strings, leaves its input alone. |
| R1.2 | `canon` | `sha256` gives known digests, the same digest for text and bytes, hashes text as UTF-8 and bytes as they are, and is 64 lowercase hex characters. |
| R1.3 | `canon` | Two key orders of one value hash the same; a changed value or array order does not. |
| R2.1 | `lock` | `necro freeze` records the path and SHA-256 of `requirements.md` and of every `*.contract.test.js` of the spec, and nothing else. |
| R2.2 | `lock` | Each frozen file has a byte-identical copy at `.necro/frozen/<sha256>` (CRLF and non-ASCII content). |
| R2.3 | `lock` | No contract files (no directory, or only other files): refuses, says at least one is needed, freezes nothing. |
| R2.4 | `lock` | Re-freezing replaces that spec's entry (not merged) and leaves another spec's entry identical. |
| R2.5 | `lock` | Freeze runs the contracts once (counted with a marker file) and records every name, passing or failing, under its own file. |
| R2.6 | `lock` | A contract file linked from outside the project, and a `contracts/<spec>` directory linked from outside, are refused. |
| R2.7 | `lock` | Task ids (text before the first `.`) and the criteria named in `(Req ...)`, once each; sub-bullets and parentheses without `Req` are not read. |
| R2.8 | `lock` | The full text after the checkbox is recorded, trimmed, the same for a ticked and an unticked task. |
| R3.1 | `block` | `fs_write` and `str_replace` to a frozen file, by relative and absolute path: exit 2, reason names the file, file unchanged. |
| R3.2 | `block` | The same for `.necro/lock.json`, `.necro/frozen/...`, a new file under `.necro/`, `.necro/state/...` and `.necro` itself. |
| R3.3 | `shell` | After a shell command, an edited and a deleted frozen file are restored byte for byte and named on stderr. |
| R3.4 | `block` | Calls that touch nothing frozen (including look-alike paths and text that mentions a protected path) exit 0 with no output, and so does PostToolUse after `ls`. |
| R3.5 | `block` | Letter case, links to frozen files (absolute and relative), a link in the middle of a path, a new file under a link to `.necro/`, a link to a file that does not exist yet, and `..` are all resolved before the check; a link to an unprotected file is allowed. |
| R3.6 | `block` | Unknown tools, `fs_append`, `delete_file` and look-alike read tools (`code`, `view_file`) are blocked for a protected path in any field, nested or not; the six documented read tools are allowed. |
| R3.7 | `shell` | A shell tick is undone with the failing names on stderr when a contract fails, kept and receipted when they pass, and an untick is left alone. |
| R3.8 | `shell` | Each `execute_bash` call replaces the record, so a tick made between two calls is not blamed on the second command; every frozen spec is recorded. |
| R3.9 | `shell` | A record rewritten, forged or deleted during the command makes every `[x]` line count as newly ticked. |
| R3.10 | `shell` | The record is taken by PostToolUse from the file as it landed, not from what PreToolUse was shown. |
| R3.11 | `block` | A too long path or a NUL in a path, or anywhere in the input of an unknown tool, is blocked; read tools, file content and shell commands are exempt. |
| R3.12 | `shell` | All four Kiro shell tools: state recorded, long command allowed, frozen file restored, tick undone. |
| R3.13 | `shell` | `fs_append` is gated like a write (including a file with no final newline), `delete_file` ticks nothing, and the state is recorded after `fs_append`. |
| R4.1 | `gate` | A `str_replace` is applied to the file on disk; ticks (also inside a line, with `X`, with a rename, or swapped with an untick) are gated, non-ticks are silent. |
| R4.2 | `gate` | An `fs_write` is compared line by line with the disk file, including CRLF; ticks are gated, same content, untick and `[x]` in notes are silent. |
| R4.3 | `gate` | A tick in an unfrozen spec exits 2 and says "not frozen", the spec name and `freeze`. |
| R4.4 | `gate` | The gate runs the contracts itself on every tick (counted with a marker file), started by the Node test runner (`NODE_TEST_CONTEXT` is set), and not for a write that ticks nothing. |
| R4.5 | `gate` | Two failing required contracts are both listed by name, a passing one is not, no receipt is written. |
| R4.6 | `gate` | All pass: exit 0, one receipt at `.necro/receipts/<spec>/<receiptHash>.json`. |
| R4.7 | `runner` | `skip`, `skip: 'reason'`, `todo` and `todo: 'reason'` are failing results, and the gate lists them. |
| R4.8 | `runner` | A contract file with no tests is one failing contract named after the file, a file that only prints is no better, and the gate exits 2 without a receipt. |
| R4.9 | `runner` | A contract file changed or deleted after freeze fails every contract in it and not those of another file; the gate lists them. |
| R4.10 | `runner` | A recorded name that a run no longer produces (a contract defined only while a flag file exists) fails; the gate lists it. |
| R4.11 | `runner` | Names with slashes, quotes, spaces, non-ASCII characters, a newline, the file stem, the base name and the relative path are kept exactly, and a failing contract named like the file stem does not fail the file. |
| R4.12 | `runner` | Printed `ok` lines cannot add a contract, pass a failing one, satisfy a recorded name or hide a bad exit code; recorded names are matched per file. |
| R4.13 | `gate` | Missing tasks.md, an added ticked line with no matching `[ ]` line, markerless boxes, an edit that does not apply to the disk file, and `fs_append` are gated; writes that do not raise the `[x]` count are silent. |
| R4.14 | `required` | A tick requires only the contracts of its recorded criteria (`fs_write` and `str_replace`), several criteria are united, `R1.1` does not match `R1.10`, and the receipt lists what was required. |
| R4.15 | `required` | Changed, dropped or added criteria, an unknown id, a renamed id, no recorded criteria, no matching contract and the last unticked task each require every contract. |
| R4.16 | `required` | A reworded line, a duplicated id (on disk and added by the write), and a tick that leaves only added or removed lines require every contract. |
| R4.17 | `required` | A required contract that passes but whose file exits badly, or whose file no longer loads, blocks the tick; a task in a healthy file is not held back. |
| R4.18 | `required` | Decoy lines (a frozen id with other text, a second copy, a reworded line) do not keep a task open; a genuinely open task still keeps the tick narrow. |
| R4.19 | `gate` | `task_update` with `completed` gets the same exit codes, message and receipt as a tick in the file; other statuses are silent; an unfrozen spec is refused. |
| R4.20 | `gate` | A `taskId` that matches no line requires every contract; a `tasksFilePath` outside the project, a link out of it, or not a spec's `tasks.md` is blocked. |
| R5.1 | `receipts` | Spec, commit (null without git, `rev-parse HEAD` with it), requirements hash, each contract's file, hash and result, and the sorted unique imported sources (found through imports of imports). |
| R5.2 | `receipts` | `receiptHash` equals the SHA-256 of canonical JSON computed independently in the test, and the file is named after it; `createdAt` is not an input. |
| R5.3 | `receipts` | Two checks of unchanged inputs give the same hash and path; a changed pinned source gives another. |
| R5.4 | `receipts` | `uncommitted` is `[]` when clean, lists an edited source, a file the commit lacks, and all four kinds of pinned file sorted, works in a subfolder of a repository, and is part of the hash. |
| R5.5 | `receipts` | A gate receipt has `task` `{ id, line }`, sorted `required`, and every result; a `check` receipt has `task` null and every contract required. |
| R6.1 | `verify` | `CONFIRMED <hash>`, exit 0, relative and absolute receipt path. |
| R6.2 | `verify` | A changed source, requirements, contract, or deleted source: `MISMATCH`, every differing path named, unchanged ones not. |
| R6.3 | `verify` | A contract that now fails (through an unpinned data file): `MISMATCH` naming it only. |
| R6.4 | `verify` | Four kinds of edited receipt, hash not recomputed: `MISMATCH` and "altered"; a changed `createdAt` is fine. |
| R6.5 | `verify` | No requirements (missing or null), no contracts (empty or missing), with a correct hash, with and without a lock. |
| R6.6 | `verify` | The lock holds another requirements hash, or another hash for one contract file: `MISMATCH` naming that path. |
| R6.7 | `verify` | A receipt that leaves out a file, leaves out or renames a contract, adds a contract or a file, names a spec the lock lacks, meets an empty lock, or hides a failing file is a `MISMATCH`; an honest receipt is a `MISMATCH` when a lock contract fails now. |
| R7.1 | `summary` | One line per frozen spec with tasks done, receipts and the contracts failing now (a contract that passed at freeze and fails today is listed; a passing one is not); a spec with no tasks.md and no receipts shows 0 and 0. |
| R8.1 | `init` | Three hooks (PreToolUse, PostToolUse, Stop), each calling `hook pre|post|stop`, each with `timeout` 300. |
| R8.2 | `init` | The steering file says frozen contracts decide "done" and must not be edited. |
| R8.3 | `init` | A second init, and an init over files the user wrote, leaves both unchanged and says they exist. |
| R8.4 | `init` | The PreToolUse hook matches every tool name tried, under Kiro's rule (no matcher, or a valid regular expression); `*` would not count. |
| R8.5 | `init` | The PostToolUse matcher matches the four shell tools and `fs_write`, `str_replace`, `fs_append`, `delete_file`. |
| R8.6 | `init` | In a copy of the tool installed under a folder with a space and a `$`, each command is two absolute double-quoted paths (this Node.js binary and this copy's `bin/necro.js`) plus `hook <name>`, and each runs with an empty PATH; PreToolUse still blocks a write to `.necro/`. |
| R8.7 | `init` | Both runs say "trusted workspace" and "quit and reopen". |
| R9.1 | `check` | Every contract of every file is printed as `pass <name>` or `fail <name>`; the receipt has `task` null and every name required. |
| R9.2 | `check` | All pass: exit 0 and the receipt path; one fails: exit 1, still prints the path and has written the receipt. |
| R9.3 | `check` | Never frozen, another spec frozen, `constructor`, `__proto__`: exit 1, "not frozen", `necro freeze demo`, no receipt. |
| R9.4 | `check` | `tasks.md` is byte for byte the same after a passing and after a failing check. |

## Criteria with no contract

None. All 73 criteria in `requirements.md` can be checked in Node, and each has a contract.

## Contracts that cover only part of the criterion

| Criterion | Not checked |
|---|---|
| R3.3 | That the restore reads from `.necro/frozen/` and not from somewhere else. The restored bytes are compared with the original. |
| R4.4 | That the process is `node --test`. The code runs each file with the `run()` API in a child process (`design.md`, "contracts are named tests"). The contract checks that the Node test runner started the contract, and that it ran for every tick. |
| R4.8 | The words "no contracts ran". The gate says `Contracts failed: <file name>.` for a file with no tests (the runner reports the file as one failing contract named after it), so the contract checks exit 2, that the file is named, and that no receipt is written. `src/check.js` has the sentence, but it can only be reached with zero results, which the runner does not return. |
| R4.9 | That the hash is taken "immediately before" the run. A change between the hash and the run cannot be arranged from outside. |
| R4.12 | That results are read from events and not from text, beyond the cases above (printed `ok` lines, error messages, noise, bad exit codes). |
| R5.1 | Pinning of sources reached only through dynamic imports, which the design does not follow. |
| R8.1 | That the command is `necro hook ...` by name: after R8.6 it is a pair of absolute paths, so the test checks the `hook pre|post|stop` ending and the `necro` script. |
| R8.6 | That the Kiro IDE started from the Dock finds the hooks. An empty PATH stands in for it. |
| R8.7 | That Kiro really needs a trusted workspace and a restart. Only the message is checked. |

## Behavior described in `design.md` that the contracts do not freeze

- A command that rewrites both the state record and its hash is not detected (`design.md`, "state the shell cannot forge").
  The README of the project states this limit, so no contract expects it to be caught.
- The 4096-character limit of R3.11 is tested with 5000 characters, not at the limit.
- `control_bash_process` and `control_pwsh_process` are tested with a `command` field. The code exempts only a field called
  `command` from the length check, so a very long string in another field of those tools would be blocked.
