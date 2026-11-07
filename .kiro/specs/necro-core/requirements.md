# Requirements: necro-core

## Introduction
The `necro` command line tool freezes contracts for a Kiro spec, gates "task done" in Kiro on those contracts, and issues
receipts anyone can re-run.

## Glossary
- **Contract file:** a `contracts/<spec>/*.contract.test.js` file.
- **Contract:** one named `node:test` test inside a contract file, usually named after the EARS criterion it checks (for example `R1.2 ...`). Results are reported per contract, not per file.

## Requirement 1: Canonical hashing
**User story:** As a reviewer, I want every hash to be reproducible, so that anyone gets the same receipt hash.
### Acceptance criteria
1. WHEN `canonicalJson(value)` is called THE SYSTEM SHALL return JSON text with object keys sorted recursively and no whitespace.
2. WHEN `sha256(textOrBytes)` is called THE SYSTEM SHALL return the SHA-256 digest as 64 lowercase hex characters.
3. WHEN the same value is hashed twice in different key orders THE SYSTEM SHALL return the same hash.

## Requirement 2: Freeze
**User story:** As a developer, I want to freeze a spec's requirements and contracts, so that they cannot move during a task.
### Acceptance criteria
1. WHEN a user runs `necro freeze <spec>` THE SYSTEM SHALL record the SHA-256 of `.kiro/specs/<spec>/requirements.md` and of every `contracts/<spec>/*.contract.test.js` file in `.necro/lock.json`.
2. WHEN a user runs `necro freeze <spec>` THE SYSTEM SHALL store a copy of each frozen file at `.necro/frozen/<sha256>`.
3. IF `contracts/<spec>/` has no contract files THEN THE SYSTEM SHALL refuse to freeze and say that at least one contract is needed.
4. WHEN a spec is frozen again THE SYSTEM SHALL replace that spec's entry and keep other specs' entries unchanged.
5. WHEN a user runs `necro freeze <spec>` THE SYSTEM SHALL run the contracts once and record the name of every contract in the lock.
6. IF a contract path resolves outside the project root THEN THE SYSTEM SHALL refuse to freeze it.
7. WHEN a user runs `necro freeze <spec>` THE SYSTEM SHALL record in the lock, for each task in that spec's `tasks.md`, the task id (the text before the first `.` on the task line, for example `8b`) and the criteria it names in `(Req 1.2, 3.1)`.
8. WHEN a user runs `necro freeze <spec>` THE SYSTEM SHALL also record each task's full line text after the checkbox.
9. WHEN a task's criteria are written on its own line or on the indented lines under it (before the next task line), as `(Req 1.2, 3.1)` or in Kiro's own format `_Requirements: 1.2, 3.1_`, THE SYSTEM SHALL record all of them for that task.

## Requirement 3: Block edits to frozen files
**User story:** As a developer, I want the agent unable to edit frozen files, so that it fixes code instead of the checks.
### Acceptance criteria
1. WHEN the PreToolUse handler receives a write tool call (`fs_write` or `str_replace`) whose path is a frozen file THE SYSTEM SHALL exit with code 2 and write a reason to stderr.
2. WHEN the PreToolUse handler receives a write tool call to any path under `.necro/` THE SYSTEM SHALL exit with code 2.
3. WHEN the PostToolUse handler runs after `execute_bash` and a frozen file's SHA-256 no longer matches the lock THE SYSTEM SHALL restore the file from `.necro/frozen/` and write to stderr which file was restored.
4. WHEN the tool call touches no frozen file THE SYSTEM SHALL exit with code 0 and print nothing.
5. WHEN a tool call names a path THE SYSTEM SHALL resolve it to its real path (following symbolic links, using the nearest existing parent for a new file) and compare it with frozen paths and `.necro/` case-insensitively.
6. IF a tool call names a protected path and the tool is not a known read-only tool (Kiro's documented read tools `read_file`, `list_directory`, `file_search`, `grep_search`, and the CLI 2.x names `grep` and `glob`) THEN THE SYSTEM SHALL block it, so an unknown write tool cannot bypass the check.
7. WHEN the PostToolUse handler runs after `execute_bash` and a task in a frozen spec's `tasks.md` changed from `[ ]` to `[x]` since the last state the gate recorded THEN THE SYSTEM SHALL run that spec's contracts and IF any fail THEN restore `tasks.md` from the recorded state and write the failing contract names to stderr.
8. WHEN the PreToolUse handler runs for `execute_bash` THE SYSTEM SHALL record each frozen spec's current `tasks.md` as the state to compare with afterwards, replacing any earlier record.
9. WHEN the PostToolUse handler runs after `execute_bash` and the recorded state file changed during the command THEN THE SYSTEM SHALL treat every `[x]` task line as newly ticked.
10. WHEN a write to `tasks.md` has been applied THE SYSTEM SHALL record the state from the file on disk in the PostToolUse handler, not before the write.
11. IF a tool input string is too long to check or contains a NUL character and the tool is not read-only THEN THE SYSTEM SHALL block the call.
12. WHEN this specification says `execute_bash` THE SYSTEM SHALL apply the same rule to every Kiro shell tool (`execute_bash`, `execute_pwsh`, `control_bash_process`, `control_pwsh_process`).
13. WHEN `fs_append` or `delete_file` targets `tasks.md` THE SYSTEM SHALL treat it like any other write to `tasks.md` for the done gate.
14. WHEN the PreToolUse handler receives a shell tool call whose command runs this tool's `freeze` command (the word `freeze` as the first argument after `necro`, `necro.js` or a path ending in `bin/necro.js`, anywhere in the command, including after `&&`, `;`, `|` or inside `bash -c`/`sh -c`) THE SYSTEM SHALL exit with code 2 and write to stderr that freezing is a person's step, because freezing rewrites the lock that `verify` trusts.
15. WHEN the PreToolUse handler runs for a shell tool THE SYSTEM SHALL record a copy of `.necro/lock.json` (or that it is absent), and WHEN the PostToolUse handler runs after a shell tool and `.necro/lock.json` differs from that record THE SYSTEM SHALL restore the recorded lock before any other check, so the frozen-file restore of 3.3 then works against the lock the person froze, and write to stderr that the lock was restored because freezing is a person's step. This holds however the command was written, so it does not depend on 3.14 recognising the command.

## Requirement 4: Gate on marking a task done
**User story:** As a developer, I want "done" refused until contracts pass, so that a ticked task means the requirements hold.
### Acceptance criteria
1. WHEN a `str_replace` targets `.kiro/specs/<spec>/tasks.md` THE SYSTEM SHALL apply it to the file on disk and treat it as marking a task done IF any task line changes from `[ ]` to `[x]`.
2. WHEN an `fs_write` targets `tasks.md` THE SYSTEM SHALL compare each task line with the file on disk and treat it as marking a task done IF any task line changes from `[ ]` to `[x]`.
3. WHEN a task is being marked done and the spec is not frozen THE SYSTEM SHALL exit with code 2 and say the spec must be frozen first.
4. WHEN a task is being marked done THE SYSTEM SHALL run the spec's frozen contracts itself with `node --test`.
5. IF any required contract fails THEN THE SYSTEM SHALL exit with code 2 and list each failing required contract by name.
6. WHEN all contracts pass THE SYSTEM SHALL write a receipt to `.necro/receipts/<spec>/<receiptHash>.json` and exit with code 0.
7. IF a contract is reported as skipped or todo THEN THE SYSTEM SHALL count it as failing.
8. IF a frozen spec's contract files contain zero contracts THEN THE SYSTEM SHALL exit with code 2 and say no contracts ran.
9. WHEN contracts are run THE SYSTEM SHALL hash each contract file immediately before running it and IF the hash differs from the lock THEN count every contract in that file as failing.
10. IF a contract name recorded in the lock is missing from a run THEN THE SYSTEM SHALL count it as failing.
11. WHEN test results are parsed THE SYSTEM SHALL keep every contract name exactly as reported, whatever characters it contains, and SHALL treat an entry as a file load failure only when its name equals that contract file's own path.
12. WHEN contracts are run THE SYSTEM SHALL read results from the Node test runner's structured events (the `node:test` `run()` API), not from text the code under test can print, and SHALL match recorded names per contract file.
13. WHEN any write targets a `tasks.md` THE SYSTEM SHALL treat it as marking a task done IF the resulting file has more `[x]` task lines than the file on disk (a missing file counts as zero), even when no single line can be matched to an earlier `[ ]` line.
14. WHEN a task is being marked done THE SYSTEM SHALL run every frozen contract of the spec and treat as required the contracts whose names start with one of the criteria the lock records for that task id (`R1.2` followed by a space or the end of the name).
15. IF the ticked task id is not in the lock, or its line in `tasks.md` now names different criteria than the lock records, or the lock records no criteria for it, or no contract matches its criteria, or it is the last unticked task of the spec THEN THE SYSTEM SHALL treat every contract as required.
16. IF the ticked line's text after the checkbox differs from the text the lock records for its id, or its id appears on more than one line of `tasks.md`, or after the tick every task the lock records is ticked or missing THEN THE SYSTEM SHALL treat every contract as required (the count of unticked tasks comes from the lock's tasks, never from lines added later).
18. WHEN the gate decides whether a frozen task is still unticked THE SYSTEM SHALL count only an unticked line whose id appears on exactly one line and whose text equals the text the lock records for that id.
19. WHEN the PreToolUse handler receives `task_update` (the Kiro IDE's spec task tool) with `status` `completed` THE SYSTEM SHALL treat it as marking done the task in the spec whose `tasks.md` is `tasksFilePath` and whose line text after the checkbox equals `taskId`, and apply the same gate, exit codes, messages and receipt as for a tick written to `tasks.md`.
20. IF a `task_update` to `completed` names a `taskId` that matches no task line, or a `tasksFilePath` outside the project THEN THE SYSTEM SHALL treat every contract of that spec as required (or block when the spec cannot be found).
17. IF a contract file that holds a required contract fails to load or run as a whole THEN THE SYSTEM SHALL treat that failure as a failing required contract.

## Requirement 5: Receipts
**User story:** As a reviewer, I want a receipt that pins every input, so that I can re-run it and get the same answer.
### Acceptance criteria
1. WHEN a receipt is written THE SYSTEM SHALL include the spec name, the git commit if available, the SHA-256 of requirements.md, of each contract file, and of each project source file the contracts import, and the pass or fail result of each contract by name.
2. WHEN a receipt is written THE SYSTEM SHALL set `receiptHash` to the SHA-256 of the canonical JSON of the receipt without the `receiptHash` and `createdAt` fields.
3. WHEN two receipts are made from identical inputs THE SYSTEM SHALL produce the same `receiptHash`.
4. WHEN a receipt is written in a git repository THE SYSTEM SHALL record in `uncommitted` the sorted list of pinned paths whose content differs from that file at the recorded commit (or that the commit lacks), and an empty list when every pinned file matches the commit.
5. WHEN a receipt is written THE SYSTEM SHALL record `task` (the ticked task id and its line) and `required` (the sorted names of the contracts that were required), and still record the result of every contract that ran.

## Requirement 6: Verify
**User story:** As anyone with the repository, I want to re-run a receipt, so that I do not have to trust the agent or the author.
### Acceptance criteria
1. WHEN a user runs `necro verify <receiptFile>` and every hashed file matches and the contracts give the same results THE SYSTEM SHALL print `CONFIRMED` and the receipt hash and exit with code 0.
2. IF a hashed file differs THEN THE SYSTEM SHALL print `MISMATCH` with each differing path and exit with code 1.
3. IF a contract result differs THEN THE SYSTEM SHALL print `MISMATCH` with each differing contract name and exit with code 1.
4. WHEN a receipt is verified THE SYSTEM SHALL first recompute its `receiptHash` and IF it differs THEN print `MISMATCH` saying the receipt was altered and exit with code 1.
5. IF a receipt pins no requirements file or no contracts THEN THE SYSTEM SHALL print `MISMATCH` and exit with code 1.
6. WHEN the spec is frozen in the local lock THE SYSTEM SHALL also check that the receipt's requirements and contract hashes match the lock and IF not THEN print `MISMATCH` with each differing path.
7. WHEN a lock exists THE SYSTEM SHALL require the receipt's spec to be in it, require the receipt's contract files, hashes and names to equal the lock's exactly (none missing, none extra), and run the lock's contracts rather than the receipt's list, so a receipt that leaves out a failing contract is a `MISMATCH`.
8. IF the receipt's requirements or contract hashes differ from the lock's for its spec AND the requirements and contract files on disk match the lock (the spec was frozen again after the receipt was written) THEN THE SYSTEM SHALL print `SUPERSEDED` with the spec name and each path whose hash changed, say that the receipt describes an earlier freeze and not today's code, and exit with code 1, instead of printing `MISMATCH`. When the files on disk do not match the lock, the rules above still print `MISMATCH`.
9. WHEN `necro verify <receiptFile>` runs from a folder that does not contain the receipt's project THE SYSTEM SHALL take as the project root the nearest folder above the receipt file that contains `.necro/lock.json`, so the result is the same from any working directory, and IF no such folder exists THEN use the current folder as before.

## Requirement 7: Session summary
**User story:** As a developer, I want a summary when the agent stops, so that a false "done" is visible.
### Acceptance criteria
1. WHEN the Stop handler runs THE SYSTEM SHALL print each spec's count of tasks marked done, count of receipts, and the names of contracts failing now.

## Requirement 8: Init
**User story:** As a developer, I want one command to set up a project, so that adoption takes a minute.
### Acceptance criteria
1. WHEN a user runs `necro init` THE SYSTEM SHALL write `.kiro/hooks/necromancer.json` with PreToolUse, PostToolUse and Stop hooks that call `necro hook pre`, `necro hook post` and `necro hook stop`, each with a timeout of 300 seconds.
2. WHEN a user runs `necro init` THE SYSTEM SHALL write `.kiro/steering/necromancer.md` telling the agent that frozen contracts decide "done" and must not be edited.
3. IF those files already exist THEN THE SYSTEM SHALL leave them unchanged and say so.
4. WHEN `necro init` writes the hooks THE SYSTEM SHALL make the PreToolUse hook match every tool (not a fixed list of write tools), so the Req 3.6 check sees unknown write tools.
5. WHEN `necro init` writes the hooks THE SYSTEM SHALL make the PostToolUse hook match every write and shell tool named in Requirement 3.
6. WHEN `necro init` writes the hook commands THE SYSTEM SHALL use the absolute path of the Node.js binary running `init` and the absolute path of `bin/necro.js`, each quoted so paths with spaces work, because the Kiro IDE started from the Dock does not have the shell's PATH.
7. WHEN `necro init` finishes THE SYSTEM SHALL say that Kiro runs hooks only in a trusted workspace and that after trusting it Kiro must be quit and reopened.
8. WHEN `necro init` writes the steering file THE SYSTEM SHALL tell the agent that a person freezes specs, that the agent must never run `necro freeze`, and that the frozen specs are listed in `.necro/lock.json`.
9. WHEN a user runs `necro init` THE SYSTEM SHALL also write `.kiro/agents/necromancer.json`, a Kiro custom agent that loads the steering file of 8.2 as a resource, carries the PreToolUse, PostToolUse and Stop hooks of 8.1, and has permission rules that deny shell commands running `necro freeze` and writes under `.necro/`, so Kiro's own permission engine refuses them before any hook runs; IF the file already exists THEN init leaves it unchanged and says so. The file SHALL pass `kiro-cli agent validate` when the Kiro CLI is installed.

## Requirement 9: Check on demand
**User story:** As a developer, I want a receipt without ticking a task, so that I can publish one for the commit I just pushed.
### Acceptance criteria
1. WHEN a user runs `necro check <spec>` on a frozen spec THE SYSTEM SHALL run every frozen contract, print each result by name, and write a receipt with `task` set to null and every contract required.
2. WHEN every contract passes THE SYSTEM SHALL exit with code 0 and print the receipt path, and IF any fails THEN THE SYSTEM SHALL exit with code 1 and still write the receipt.
3. IF the spec is not frozen THEN THE SYSTEM SHALL exit with code 1 and say to freeze it first.
4. WHEN `necro check` runs THE SYSTEM SHALL not change `tasks.md`.

