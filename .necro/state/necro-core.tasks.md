# Tasks: necro-core

Each task writes its test first, then the implementation, then runs `node --test`.

- [x] 1. **Project scaffold and canonical hashing** (Req 1.1, 1.2, 1.3)
  - Test first: write `test/canon.test.js` asserting `canonicalJson` sorts object keys recursively and produces no whitespace (1.1); `sha256` returns 64 lowercase hex characters for strings and bytes (1.2); the same value with keys in different orders produces the same hash (1.3). Create `package.json` with `"type": "module"`, `"bin": { "necro": "bin/necro.js" }`, and `"engines": { "node": ">=24" }`.
  - Implement: `src/canon.js` exporting `canonicalJson`, `sha256`, `hashFile`. Run `node --test test/canon.test.js` and pass.

- [x] 2. **Lock file: freeze a spec** (Req 2.1, 2.2, 2.3, 2.4)
  - Test first: write `test/lock.test.js` with fixtures in `test/fixtures/` (a fake spec dir with `requirements.md` and one contract file). Assert `freezeSpec` records the SHA-256 of `requirements.md` and each contract in `.necro/lock.json` (2.1); stores a copy of each frozen file at `.necro/frozen/<sha256>` (2.2); refuses with a plain message when `contracts/<spec>/` has no contract files (2.3); re-freezing replaces the spec's entry and keeps other specs' entries (2.4).
  - Implement: `src/lock.js` exporting `readLock`, `writeLock`, `freezeSpec`, `isSpecFrozen`, `isFrozenPath`, `frozenFiles`, `getExpectedHash`. Run `node --test` and pass.

- [x] 3. **Contracts runner** (supports Req 4.4, 4.5, 6.1, 6.3)
  - Test first: write `test/contracts.test.js` with fixtures (a passing contract and a failing contract). Assert `runContracts` returns an array with each contract's `name`, `path`, `sha256`, and `result` (`"pass"` or `"fail"`) (4.4); a failing contract's name appears in the results (4.5).
  - Implement: `src/contracts.js` exporting `runContracts(cwd, spec, lock)` — runs each contract file with `node --test --test-reporter=tap <contractPath>` and parses the TAP output so each named test is one contract with its own `"pass"` or `"fail"`; a file that fails to load counts as one failing contract named after the file. Run `node --test` and pass.

- [x] 3b. **No vacuous passes** (Req 4.7, 4.8)
  - Test first: extend `test/contracts.test.js`. Assert a test marked skip or todo is reported as `"fail"` (4.7). Assert a contract file that loads but defines zero tests produces one failing contract named after the file, so a spec can never pass with zero contracts (4.8).
  - Implement: update `src/contracts.js`. Run `npm test` and pass.

- [x] 4. **Receipts** (Req 5.1, 5.2, 5.3)
  - Test first: write `test/receipts.test.js` with fixtures. Assert a built receipt includes the spec name, git commit (or null), SHA-256 of `requirements.md`, of each contract file, of each imported source file, and the pass/fail result of each contract by name (5.1); `receiptHash` equals `sha256(canonicalJson(receipt without receiptHash and createdAt))` (5.2); two receipts built from identical inputs produce the same `receiptHash` (5.3).
  - Implement: `src/receipts.js` exporting `traceImports`, `buildReceipt`, `computeReceiptHash`, `writeReceipt`. Run `node --test` and pass.

- [x] 5. **Verify** (Req 6.1, 6.2, 6.3)
  - Test first: write `test/verify.test.js` with fixtures. Assert `verify` prints `CONFIRMED` and the receipt hash and exits 0 when every hashed file matches and contracts give the same results (6.1); prints `MISMATCH` with each differing path and exits 1 when a hashed file differs (6.2); prints `MISMATCH` with each differing contract name and exits 1 when a contract result differs (6.3).
  - Implement: `src/verify.js` exporting `verify(cwd, receiptFile)` — recomputes file hashes, re-runs contracts, compares, prints result, returns exit code. Run `node --test` and pass.

- [x] 3c. **Pin contract names and check files before running** (Req 2.5, 2.6, 4.9, 4.10)
  - Test first: extend `test/lock.test.js` and `test/contracts.test.js`. Assert freeze records every contract name in the lock (2.5); a contract path outside the project root is refused at freeze (2.6); a contract file changed after freeze makes all its contracts fail (4.9); a contract name in the lock that is missing from a run is reported as failing (4.10).
  - Implement: update `src/lock.js` and `src/contracts.js`. Run `npm test` and pass.

- [x] 6. **PreToolUse: block edits to frozen files** (Req 3.1, 3.2, 3.4)
  - Test first: write `test/hooks.test.js` with fixtures (a frozen spec in `.necro/lock.json`). Assert `handlePreToolUse` exits 2 with a reason on stderr for `fs_write` / `str_replace` to a frozen file path (3.1); exits 2 for any path under `.necro/` (3.2); exits 0 and prints nothing when the path is not frozen (3.4).
  - Implement: `src/hooks.js` with `handlePreToolUse` — resolves the path project-relative, checks `.necro/` and frozen-path conditions. Run `node --test` and pass.

- [x] 7. **Gate on marking a task done** (Req 4.1, 4.2, 4.3, 4.4, 4.5, 4.6)
  - Test first: extend `test/hooks.test.js`. Assert `str_replace` on `tasks.md` with more `[x]` in `newStr` than `oldStr` is detected as marking done (4.1); `fs_write` on `tasks.md` with more `[x]` than the file on disk is detected as marking done (4.2); an unfrozen spec exits 2 with a freeze instruction (4.3); contracts are run (4.4); any failing contract exits 2 and lists names (4.5); all passing writes a receipt to `.necro/receipts/<spec>/<hash>.json` and exits 0 (4.6).
  - Implement: add `countTaskMarks`, `detectTaskDone`, and the gate flow to `handlePreToolUse` in `src/hooks.js` (calls `lock`, `contracts`, `receipts`). Run `node --test` and pass.

- [x] 8. **PostToolUse: restore frozen files** (Req 3.3)
  - Test first: extend `test/hooks.test.js`. Assert `handlePostToolUse` after `execute_bash` restores a frozen file whose SHA-256 changed from `.necro/frozen/<hash>` and writes the file name to stderr (3.3); exits 0 and prints nothing when no frozen file changed.
  - Implement: add `handlePostToolUse` to `src/hooks.js`. Run `node --test` and pass.

- [x] 8b. **Hardening from review** (Req 4.11, 6.4, 6.5, 6.6)
  - Test first: a contract named with a slash or ending in `.js` (for example `handles a/b.js paths`) is kept and reported (4.11); verify reports `MISMATCH` when a receipt's fields were edited so its `receiptHash` no longer matches (6.4); verify rejects a receipt with no requirements or no contracts (6.5); verify reports `MISMATCH` when the receipt's requirements or contract hashes differ from the local lock (6.6).
  - Implement: update `src/contracts.js` and `src/verify.js`. Run `npm test` and pass.

- [x] 8c. **Close the bypasses found in review** (Req 3.5, 3.6, 3.7, 4.1, 4.2, 4.12)
  - Test first: a write to `Contracts/...` (other case) or through a symlink to a frozen file is blocked (3.5); an unknown tool name with a protected path is blocked (3.6); a shell command that ticks a task while contracts fail gets `tasks.md` restored with the failing names on stderr (3.7); a `str_replace` that unticks one task and ticks another is detected as marking done (4.1); results printed by code under test (a fake `ok 1 - name` line) cannot make a contract pass, and names are matched per file (4.12).
  - Implement: update `src/hooks.js` and `src/contracts.js` (switch to the `node:test` `run()` API). Run `npm test` and pass.

- [x] 8d. **Fail closed on ticks, strict verify, hooks on every tool** (Req 4.13, 6.7, 8.4)
  - Test first: a write to `tasks.md` that adds an `[x]` line with no matching `[ ]` line before it (including a new file and a partial-line `str_replace`) runs the gate (4.13); `verify` reports `MISMATCH` for a receipt that omits one of the lock's contracts, adds one the lock lacks, changes a recorded name, or names a spec missing from the lock, and it runs the lock's contracts (6.7); `necro init` writes a PreToolUse matcher that matches every tool (8.4). Run each test against the current code and see it fail first.
  - Implement: update `src/hooks.js`, `src/verify.js`, `templates/necromancer.hooks.json`. Run `npm test` and pass.

- [x] 8e. **State the shell cannot forge, fail closed on odd input, honest limits** (Req 3.8, 3.9, 3.10, 3.11)
  - Test first: a shell command that edits `.necro/state/<spec>.tasks.md` and ticks a task while contracts fail still gets `tasks.md` restored (3.8, 3.9); state is recorded after an `fs_write`/`str_replace` lands, from disk (3.10); a write tool whose input holds a string over the length limit or with a NUL is blocked (3.11). Run each test against the current code and see it fail first.
  - Implement: update `src/hooks.js`; in `README.md` add a short "Limits" section: a shell command or contract code can change any file, so the hooks are guard rails and the guarantee is `necro verify`, which re-runs the frozen contracts. Run `npm test` and pass.

- [x] 9. **Stop: session summary** (Req 7.1)
  - Test first: extend `test/hooks.test.js`. Assert `handleStop` prints each frozen spec's count of tasks marked done, count of receipts, and names of contracts failing now (7.1).
  - Implement: add `handleStop` to `src/hooks.js`. Run `node --test` and pass.

- [x] 10. **CLI entry and init command** (Req 8.1, 8.2, 8.3)
  - Test first: write `test/cli.test.js`. Assert `necro init` writes `.kiro/hooks/necromancer.json` with PreToolUse, PostToolUse, and Stop hooks calling `necro hook pre` / `post` / `stop` at 300s timeout (8.1); writes `.kiro/steering/necromancer.md` (8.2); leaves existing files unchanged and says so (8.3). Assert the CLI routes `freeze`, `verify`, `init`, and `hook pre|post|stop` subcommands to the right modules.
  - Implement: `bin/necro.js` (arg parsing + dispatch) and `templates/necromancer.hooks.json`, `templates/necromancer.steering.md`. Run `node --test` and pass.

- [x] 11. **Receipts say what is not committed yet** (Req 5.4)
  - Test first: in a temp git repo, a receipt written after editing a pinned source file without committing lists that path in `uncommitted`; after committing, a new receipt has `uncommitted: []`; a pinned file missing from the commit is listed. Run each test against the current code and see it fail first.
  - Implement: update `src/receipts.js` (compare each pinned file's SHA-256 with `git show <commit>:<path>`). Run `npm test` and pass.

- [x] 12. **Gate on the ticked task's own criteria** (Req 2.7, 4.5, 4.14, 4.15, 5.5)
  - Test first: freeze records each task id with its criteria (2.7); ticking a task whose required contracts pass is allowed while another task's contracts fail, and the receipt records `task`, `required` and every result (4.14, 5.5); a failing required contract blocks and is listed (4.5); an edited task line, an unknown task id, a task with no criteria or no matching contract, and the last unticked task all require every contract (4.15); a shell command that ticks several tasks requires the union for those ids (3.7). Run each test against the current code and see it fail first.
  - Implement: update `src/lock.js`, `src/hooks.js`, `src/receipts.js`. `verify` stays as it is (it re-runs every contract against the lock). Run `npm test` and pass.

- [x] 13. **Bind ticks to the frozen task text** (Req 2.8, 4.16, 4.17)
  - Test first: freeze records each task's line text (2.8); ticking a line that reuses an easy task's id and criteria with different text, a duplicated id, and a tick that leaves only added (not frozen) task lines unticked all require every contract (4.16); a contract file that fails to load while holding a required contract blocks the tick (4.17). Run each test against the current code and see it fail first.
  - Implement: update `src/lock.js` and `src/hooks.js`. Run `npm test` and pass.

- [x] 14. **Kiro's real tool names, in the IDE too** (Req 3.6, 3.12, 3.13, 8.5)
  - Test first: `file_search` and `grep_search` on a frozen path are allowed, `code` and any unknown tool are not (3.6); a tick made through `execute_pwsh` or `control_bash_process` is checked like `execute_bash` (3.12); an `fs_append` that adds a ticked task line runs the gate (3.13); `necro init` writes a PostToolUse matcher covering every write and shell tool (8.5). Run each test against the current code and see it fail first.
  - Implement: update `src/hooks.js` and `templates/necromancer.hooks.json`. Run `npm test` and pass.

- [x] 15. **Decoy lines cannot keep a task open** (Req 4.18)
  - Test first: when the last real frozen task is ticked, an added unticked line that reuses a frozen id with different text, or a second unticked copy of a frozen line, does not stop every contract from being required (4.18). Run the test against the current code and see it fail first.
  - Implement: update `src/lock.js`. Run `npm test` and pass.

- [x] 16. **Gate the Kiro IDE's task tool** (Req 4.19, 4.20)
  - Test first, using payloads recorded from the Kiro IDE (`tool_name: "task_update"`, `tool_input: { tasksFilePath, taskId, status, error }`, where `taskId` is the task line text such as "1. Implement `slugify` in `src/slugify.js` (Req 1.1, 1.2)"): `completed` with a failing required contract exits 2 and names it; `completed` with passing contracts exits 0 and writes a receipt with that task; `in_progress`, `queued` and `task_list` are allowed silently; an unknown `taskId` requires every contract; a `tasksFilePath` outside the project is blocked (4.19, 4.20). Run each test against the current code and see it fail first.
  - Implement: update `src/hooks.js`. Run `npm test` and pass.

- [x] 17. **Hooks that work from the Dock, and check on demand** (Req 8.6, 8.7, 9.1, 9.2, 9.3, 9.4)
  - Test first: `necro init` writes commands with the absolute `node` path (`process.execPath`) and the absolute `bin/necro.js` path, quoted, and they run from a directory containing a space (8.6); `init` prints the trusted-workspace note (8.7); `necro check` writes a receipt with `task: null` and every contract required, exits 0 or 1 by result, refuses an unfrozen spec, and leaves `tasks.md` unchanged (9.1-9.4). Run each test against the current code and see it fail first.
  - Implement: `bin/necro.js`, `src/receipts.js` or a new `src/check.js`, README usage. Run `npm test` and pass.

- [x] 18. **Read criteria the way Kiro writes them** (Req 2.9)
  - Test first: criteria on the task line, on an indented sub-line as `(Req 1.4, 2.1)`, and as Kiro's `_Requirements: 1.4, 2.1_` are all recorded for that task, and criteria under a later task are not; the gate then requires the matching contracts (2.9). Run the tests against the current code and see them fail first.
  - Implement: `src/lock.js`. Then add `contracts/necro-core/criteria-format.contract.test.js` with one contract named `R2.9 ...` for this criterion (a new file; do not change the frozen contract files). Run `npm test` and pass.

- [x] 19. **Freezing is a person's step, and a re-frozen spec's old receipts say so** (Req 3.14, 6.8, 8.8)
  - Test first: a shell tool call (`execute_bash` and the other shell tools of Req 3.12) whose command runs `necro freeze x`, `node bin/necro.js freeze x`, `node "/abs/path with space/bin/necro.js" freeze x`, `npm test && necro freeze x` or `bash -c "necro freeze x"` exits 2 and names freezing as a person's step; `necro check x`, `necro verify r.json` and a command that only mentions the word freeze (`echo freeze`, `grep freeze README.md`) are allowed (3.14). A receipt written before its spec was frozen again, with the files on disk matching the new lock, prints `SUPERSEDED` with the spec and the changed paths and exits 1; with a lock edited so the files on disk no longer match it, the same receipt still prints `MISMATCH` (6.8). `necro init` writes a steering file that says a person freezes specs, the agent never runs `necro freeze`, and frozen specs are listed in `.necro/lock.json`, and no longer tells the agent to run `necro freeze` (8.8). Run each test against the current code and see it fail first.
  - Implement: `src/hooks.js`, `src/verify.js` (or where verify lives), `templates/necromancer.steering.md`, and copy the new template text to `.kiro/steering/necromancer.md`. Then add `contracts/necro-core/person-freeze.contract.test.js` with contracts named `R3.14 ...`, `R6.8 ...` and `R8.8 ...` (a new file; do not change the frozen contract files). Run `npm test` and pass. Do not run `necro freeze`; a person freezes the spec after reviewing the new contracts.

- [x] 20. **An agent's shell cannot move the lock** (Req 3.15)
  - Test first: a shell tool call that rewrites `.necro/lock.json` by any route (running freeze through a variable such as `F=freeze; necro $F x`, through `node -e`, or by writing the file directly) and edits a frozen contract has, after the PostToolUse handler, the lock restored byte for byte, the frozen contract restored by the 3.3 rule, and a stderr message naming the lock; a shell call that does not touch the lock leaves it alone and prints nothing about it; a missing lock that a command creates is removed again (3.15). Run each test against the current code and see it fail first.
  - Implement: `src/hooks.js` (record the lock in the pre handler next to the 3.8 state record, under `.necro/state/`; restore it first in the post handler). Then add `contracts/necro-core/lock-restore.contract.test.js` with one contract named `R3.15 ...` (a new file; do not change frozen contract files). Run `npm test` and pass. Do not run `necro freeze`; do not tick task 20 yet.

- [ ] 21. **A custom Kiro agent that brings the gate with it** (Req 8.9)
  - First read Kiro's custom agent format (https://kiro.dev/docs/custom-agents/configuration-reference/): `tools`, `permissions.rules` with `capability`, `match` and `effect`, `resources`, `hooks`. Use the fields the CLI V3 engine reads.
  - Test first: `necro init` writes `.kiro/agents/necromancer.json` with the steering file as a `file://` resource, the three hooks with the same commands and timeouts as `.kiro/hooks/necromancer.json`, and deny rules for shell commands that run `necro freeze` (every spelling 3.14 covers that a glob can express) and for writes under `.necro/`; a second `init` leaves an existing agent file unchanged and says so (8.9). Run each test against the current code and see it fail first.
  - Implement: a template in `templates/`, `src/init.js` (or where init lives). Run `kiro-cli agent validate --path <file>` on the written file if the CLI is installed and report the result. Write this repository's own `.kiro/agents/necromancer.json` with `necro init`'s output adapted to `node bin/necro.js`. Then add `contracts/necro-core/custom-agent.contract.test.js` with one contract named `R8.9 ...` (a new file). Run `npm test` and pass. Do not run `necro freeze`; do not tick task 21 yet.
