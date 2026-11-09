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
9. WHEN `necro verify <receiptFile>` runs from a folder that does not contain the receipt's project THE SYSTEM SHALL take as the project root the nearest folder above the receipt file that contains `.necro/lock.json`, so the result is the same from any working directory (apart from the `Project:` line of 6.10), and IF no such folder exists THEN use the current folder as before.
10. WHEN `necro verify` uses a project root other than the current folder THE SYSTEM SHALL first print `Project: <absolute path>` so the user sees whose contracts run.

## Requirement 7: Session summary
**User story:** As a developer, I want a summary when the agent stops, so that a false "done" is visible.
### Acceptance criteria
1. WHEN the Stop handler runs THE SYSTEM SHALL print each spec's count of tasks marked done and count of receipts, and the names of the contracts failing among those it ran for tasks ticked since the last freeze; WHEN it ran none THE SYSTEM SHALL say so and name `necro audit` as the full check. (Revised Nov 10: running every contract at each stop took close to the hooks' time limit.)

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

## Requirement 10: MCP server and Kiro power
**User story:** As a developer using Kiro, I want the agent to ask which contracts block a task and to re-run receipts through MCP, and to install the whole workflow as a Kiro power, so that the gate is one install away and the agent sees the contracts before it tries to tick.
### Acceptance criteria
1. WHEN a user runs `necro mcp` THE SYSTEM SHALL serve the Model Context Protocol over stdio (JSON-RPC 2.0, newline-delimited: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) with no dependencies beyond Node.js.
2. WHEN `tools/list` is called THE SYSTEM SHALL offer exactly three tools: `necro_status` (for each frozen spec, each task with ticked or not, the contracts it requires, and each contract's current pass or fail), `necro_check` (run `necro check <spec>` and return the results and the receipt path) and `necro_verify` (verify a receipt path and return CONFIRMED, MISMATCH or SUPERSEDED with the message).
3. THE SYSTEM SHALL offer no tool that freezes a spec, edits a frozen file or ticks a task, and IF a tool call names any other tool or a spec that is not frozen THEN THE SYSTEM SHALL return a tool error with one plain sentence, not crash.
4. WHEN a tool takes a spec name or a receipt path THE SYSTEM SHALL refuse a name or path outside the project root.
5. WHEN the repository is installed as a Kiro power THE SYSTEM SHALL provide a `power/` folder with `plugin.json` (the Agent Plugins 1.0.0 fields `$schema`, `name`, `version`, `description`, `author`, `keywords`), `mcp.json` that starts `necro mcp`, and `skills/contract-necromancer/SKILL.md` that teaches the workflow (EARS criteria, contracts drafted for a person to review, the person freezes, check status before ticking, verify receipts).


## Requirement 11: One-command demo
**User story:** As a judge or a developer who has never installed the tool, I want one command that shows the gate refuse a false "done", accept the real fix, and re-check the receipt, so that I can see what it does in under a minute without Kiro, npm accounts or setup.
### Acceptance criteria
1. WHEN a user runs `necro demo` THE SYSTEM SHALL copy the bundled `examples/pumpkin-ledger` project into a new folder under the operating system's temporary directory, run every step there, print that folder's path, and change nothing outside it.
2. WHEN the demo runs THE SYSTEM SHALL reopen task 4 in the copy, plant the rounding bug from the README (each share rounded, so cents are lost), send the gate the same `task_update` call the Kiro IDE sends when a task completes, and print that the gate refused the tick together with the names of the failing contracts.
3. WHEN the refusal has been shown THE SYSTEM SHALL restore the correct code, send the same call again, and print that the gate accepted the tick and the path of the receipt it wrote.
4. WHEN the receipt has been written THE SYSTEM SHALL run `necro verify` on it and print `CONFIRMED`, then change the copy's `src/split.js`, verify the same receipt again and print `MISMATCH`.
5. THE SYSTEM SHALL exit 0 only if the refusal, the acceptance, `CONFIRMED` and `MISMATCH` all happened as described, and otherwise exit 1 naming the step that did not.
6. WHEN the package is run with `npx -y github:vijaygopalbalasa/contract-necromancer demo` on a machine with Node.js 24 and no global `necro` THE SYSTEM SHALL run the same demo, using only files that the package contains.

## Requirement 12: A demo that reads at a glance
**User story:** As a judge watching `necro demo` in a terminal, I want the refusal, the acceptance and the verdicts to stand out, and to know where to look next, so that the result lands without reading every line.
### Acceptance criteria
1. WHEN `necro demo` writes to a terminal (stdout is a TTY) and the `NO_COLOR` environment variable is not set THE SYSTEM SHALL colour the refusal and `MISMATCH` red and the acceptance and `CONFIRMED` green, and mark each with a short text symbol that also reads without colour.
2. WHEN stdout is not a TTY or `NO_COLOR` is set THE SYSTEM SHALL print no ANSI escape codes, so piped output, CI logs and the existing Requirement 11 contracts see plain text.
3. WHEN the demo succeeds THE SYSTEM SHALL end with one line naming the live receipt viewer, `https://vijaygopalbalasa.github.io/contract-necromancer/`, and saying the receipt file can be opened there (pasted or chosen), without claiming a direct link to the temporary file.

## Requirement 13: Contracts in any language
**User story:** As a developer whose Kiro project is not written in JavaScript (Python, Go, Java, Rust and others), I want my contracts in my own test framework, so that the gate and receipts work for my stack.
### Acceptance criteria
1. WHERE a spec has a file `.kiro/specs/<spec>/runners.json` mapping a file-name pattern (a glob under `contracts/<spec>/`, for example `test_*_contract.py`) to a command with the placeholders `{file}` and `{report}` THE SYSTEM SHALL treat files matching a pattern as contract files of that spec, alongside `*.contract.test.js`, in freeze, check, the gate and verify.
2. WHEN such a contract file runs THE SYSTEM SHALL run its command without a shell (the command split into arguments), with `{file}` replaced by the file's path and `{report}` by a new path inside a fresh temporary folder, and SHALL read results only from the JUnit XML report written there (each `testcase` passes unless it holds `failure` or `error`; a `skipped` testcase counts as not passing), never from the command's printed output.
3. WHEN reading a report THE SYSTEM SHALL name each contract by its `testcase` `name` attribute, so a testcase whose name starts `R<n>.<m>` is the contract for that criterion, exactly as for JavaScript contracts.
4. IF the command cannot start, exits without writing a report, writes XML that does not parse, or the report holds no testcase, THEN THE SYSTEM SHALL count the file as one failing contract with a plain reason naming the file, never as passing.
5. WHEN a spec is frozen THE SYSTEM SHALL lock `runners.json` by hash with the spec's requirements and contracts, so the gate's PostToolUse restore puts it back if the agent edits it and `necro verify` reports MISMATCH if it changed.
6. THE SYSTEM SHALL ship an example under `examples/` with a small Python project whose spec has pytest contracts and a `runners.json` running `python3 -m pytest {file} --junitxml={report} -q`, frozen, with at least one receipt written by the gate, and its README SHALL say pytest must be installed.
7. WHEN a runner command exits with a non-zero status, or runs longer than the runner time limit (240 seconds by default, below the hooks' 300) THE SYSTEM SHALL count the file as failing with a reason naming the exit status or the timeout, kill the command and its child processes on timeout, and remove its temporary folder; the same time limit SHALL apply to JavaScript contract files.
8. WHEN a runner command runs THE SYSTEM SHALL replace `{file}` and `{report}` in one pass, and SHALL give the command a fresh, empty temporary folder in `PYTHONPYCACHEPREFIX` and set `PYTHONDONTWRITEBYTECODE=1`, so stale compiled files written earlier cannot stand in for changed source.
9. WHERE `runners.json` lists, under the reserved key `"sources"`, an array of globs relative to the project root THE SYSTEM SHALL pin the matching files in the receipt like the sources of a JavaScript contract, so `necro verify` reports MISMATCH when one changes, and SHALL also lock any files listed under the reserved key `"frozen"` (for example `conftest.py`, `pytest.ini`) with the spec.
10. THE README SHALL state plainly what runner contracts cannot defend against: code under test runs inside the test framework's own process and can tamper with it, and the gate trusts the language environment (installed packages, interpreter) as much as the test framework does.
11. WHEN a runner command runs THE SYSTEM SHALL remove from its environment the variables that redirect an interpreter or test framework to other code (`PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `PYTHONUSERBASE`, `PYTEST_ADDOPTS`, `PYTEST_PLUGINS`, `NODE_OPTIONS`, `NODE_PATH`), and the same SHALL hold for JavaScript contract files.
12. WHEN runner contracts run, and WHEN `necro verify` runs, THE SYSTEM SHALL expand the `"frozen"` globs of the locked `runners.json` again and count every runner file of the spec as failing (verify: MISMATCH) IF the set of matching files differs from the locked set, so a matching file added after the freeze (for example a new `conftest.py`) is caught as well as a changed one.
13. WHEN `"frozen"` globs are expanded THE SYSTEM SHALL count a symbolic link whose path matches a glob as a matching file (never skip it), so a link planted where a frozen file is expected is caught as added.

## Requirement 14: Catch a tick however it got there
**User story:** As a developer who runs Kiro's "Run all tasks" or lets sub-agents work unattended, I want a tick that did not go through the gate to be caught and undone, so that a task Kiro marks done after a failed or killed run (as in kirodotdev/Kiro#11786) never stays done.
### Acceptance criteria
1. WHEN a user runs `necro audit` (all frozen specs) or `necro audit <spec>` THE SYSTEM SHALL list every ticked task of each frozen spec with one verdict: `ok` when every contract the task requires passes now and either the gate wrote a receipt for that task id (under any freeze of the spec) or the task was already ticked when a person last froze the spec (the person accepted it then), `no receipt` when no such receipt exists, and `failing` with the names of required contracts that fail now; and SHALL exit 0 only if every ticked task is `ok`.
2. WHEN `necro audit` runs THE SYSTEM SHALL change no file, so it can run in CI and on a fresh clone.
3. WHEN the Stop handler runs, and WHEN a PostTaskExec handler (`necro hook posttask`) runs, THE SYSTEM SHALL find every ticked task that is not `ok` under 14.1, put its line back to `[ ]` in `tasks.md`, and print to stderr each task undone and why, without relying on any field of the hook's input.
4. WHEN a user runs `necro init` THE SYSTEM SHALL also write a PostTaskExec hook that runs `necro hook posttask`, in the hooks file and the custom agent, with the same timeout as the others.
5. THE repository's CI SHALL run `necro audit` on every push, and the README SHALL show the one CI step a project adds to do the same.
6. IF a spec's lock records no list of tasks ticked at freeze (a lock written before this requirement) THEN the Stop and PostTaskExec handlers SHALL untick nothing for that spec and SHALL print once that a person must freeze the spec again to turn the check on, while `necro audit` still reports every verdict.
7. WHEN the Stop or PostTaskExec handler runs THE SYSTEM SHALL audit only the tasks that are ticked now and were not ticked when a person last froze the spec, so the handler finishes well inside the hooks' time limit on a large project; `necro audit` SHALL still check every ticked task.
8. THE README SHALL say that receipts are files in the project, so an agent able to write files can add one; a forged receipt can only make `necro audit` accept a task whose required contracts pass now, so it can fake where a tick came from, not whether the work holds.
9. THE repository's CI SHALL run `necro audit` for this repository and SHALL re-run with `necro verify` the newest receipt of each spec of the two examples, instead of the newest receipt of this repository's own specs (whose shared source files change with every later task, so their receipts are snapshots).

