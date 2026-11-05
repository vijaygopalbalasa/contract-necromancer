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

## Requirement 3: Block edits to frozen files
**User story:** As a developer, I want the agent unable to edit frozen files, so that it fixes code instead of the checks.
### Acceptance criteria
1. WHEN the PreToolUse handler receives a write tool call (`fs_write` or `str_replace`) whose path is a frozen file THE SYSTEM SHALL exit with code 2 and write a reason to stderr.
2. WHEN the PreToolUse handler receives a write tool call to any path under `.necro/` THE SYSTEM SHALL exit with code 2.
3. WHEN the PostToolUse handler runs after `execute_bash` and a frozen file's SHA-256 no longer matches the lock THE SYSTEM SHALL restore the file from `.necro/frozen/` and write to stderr which file was restored.
4. WHEN the tool call touches no frozen file THE SYSTEM SHALL exit with code 0 and print nothing.

## Requirement 4: Gate on marking a task done
**User story:** As a developer, I want "done" refused until contracts pass, so that a ticked task means the requirements hold.
### Acceptance criteria
1. WHEN a `str_replace` on `.kiro/specs/<spec>/tasks.md` has more `[x]` marks in `newStr` than in `oldStr` THE SYSTEM SHALL treat it as marking a task done.
2. WHEN an `fs_write` on `tasks.md` has more `[x]` marks than the file currently on disk THE SYSTEM SHALL treat it as marking a task done.
3. WHEN a task is being marked done and the spec is not frozen THE SYSTEM SHALL exit with code 2 and say the spec must be frozen first.
4. WHEN a task is being marked done THE SYSTEM SHALL run the spec's frozen contracts itself with `node --test`.
5. IF any contract fails THEN THE SYSTEM SHALL exit with code 2 and list each failing contract by name.
6. WHEN all contracts pass THE SYSTEM SHALL write a receipt to `.necro/receipts/<spec>/<receiptHash>.json` and exit with code 0.
7. IF a contract is reported as skipped or todo THEN THE SYSTEM SHALL count it as failing.
8. IF a frozen spec's contract files contain zero contracts THEN THE SYSTEM SHALL exit with code 2 and say no contracts ran.

## Requirement 5: Receipts
**User story:** As a reviewer, I want a receipt that pins every input, so that I can re-run it and get the same answer.
### Acceptance criteria
1. WHEN a receipt is written THE SYSTEM SHALL include the spec name, the git commit if available, the SHA-256 of requirements.md, of each contract file, and of each project source file the contracts import, and the pass or fail result of each contract by name.
2. WHEN a receipt is written THE SYSTEM SHALL set `receiptHash` to the SHA-256 of the canonical JSON of the receipt without the `receiptHash` and `createdAt` fields.
3. WHEN two receipts are made from identical inputs THE SYSTEM SHALL produce the same `receiptHash`.

## Requirement 6: Verify
**User story:** As anyone with the repository, I want to re-run a receipt, so that I do not have to trust the agent or the author.
### Acceptance criteria
1. WHEN a user runs `necro verify <receiptFile>` and every hashed file matches and the contracts give the same results THE SYSTEM SHALL print `CONFIRMED` and the receipt hash and exit with code 0.
2. IF a hashed file differs THEN THE SYSTEM SHALL print `MISMATCH` with each differing path and exit with code 1.
3. IF a contract result differs THEN THE SYSTEM SHALL print `MISMATCH` with each differing contract name and exit with code 1.

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
