---
name: contract-necromancer
description: Use frozen, executable contracts to decide when a Kiro spec task is done. Draft contracts for EARS acceptance criteria, check which contracts a task needs before ticking it, and verify receipts.
---

# Contract Necromancer

A task is done when the frozen contracts for its requirements pass, not when the agent says so. Each EARS acceptance
criterion in `.kiro/specs/<spec>/requirements.md` has an executable contract in `contracts/<spec>/`. A person freezes the
spec. After that, the requirements and the contracts cannot be edited during a task, and a task cannot be ticked until
its contracts pass.

## Setup (once per machine and project)

The power's MCP server runs the `necro` command, so put it on your PATH first:
`npm install -g github:vijaygopalbalasa/contract-necromancer` (Node.js 24 or newer, no dependencies), or `npm link` from
a clone. Then, in your project, run `necro init` to add the hooks, the steering file and the `necromancer` custom agent,
trust the workspace in Kiro, and quit and reopen Kiro so the hooks load.

The tools below come from the `necro` MCP server. They only read and run things. None of them freezes a spec, edits a
frozen file or ticks a task.

## Step 1: Write criteria in EARS form

Write each acceptance criterion as one sentence in EARS form, numbered inside its requirement:

`WHEN <event> THE SYSTEM SHALL <response>.`
`IF <condition> THEN THE SYSTEM SHALL <response>.`

Name the criteria a task covers on the task line, for example `(Req 1.2, 3.1)`, or in Kiro's own form
`_Requirements: 1.2, 3.1_`.

## Step 2: Draft contracts for a person to review

For each criterion, write `contracts/<spec>/<topic>.contract.test.js` using `node:test`. Name each test after the
criterion, starting with `R<requirement>.<criterion>`, for example `R1.2 sha256 returns 64 lowercase hex characters`.
The task's criteria select its contracts by that prefix.

These files are drafts. Ask the person to review them. Do not freeze them yourself.

## Step 3: A person freezes the spec

Freezing records the hashes of the requirements and contracts in `.necro/lock.json` and the names of the tasks. A
person runs `necro freeze <spec>` after reviewing the contracts. Never run `necro freeze` yourself: it rewrites the lock
that `necro verify` trusts. If a frozen contract looks wrong, do not edit it. Fix the code, or write a new draft
contract and ask the person to review it and freeze again.

## Step 4: Check status before you tick

Before you mark a task done, call `necro_status` for the spec. It lists every task, whether it is ticked, the contracts
that ticking it requires, and the current pass or fail of each one. If a required contract fails, fix the code and call
`necro_status` again. Tick the task only when every required contract passes.

Call `necro_check` with the spec name to run every frozen contract and write a receipt in `.necro/receipts/<spec>/`.
It returns each contract's result and the receipt path.

## Step 5: Verify receipts

Call `necro_verify` with a receipt path inside the project. It re-hashes every pinned file, re-runs the frozen
contracts and returns one of:

- `CONFIRMED`: the files and results match, so the receipt holds.
- `MISMATCH`: a pinned file or a contract result differs. The message names it.
- `SUPERSEDED`: the spec was frozen again after the receipt was written. Run `necro_check` for a current receipt.

## Limits

The server works in the folder it was started in and refuses paths outside it. A shell command can still change any
file, so the hooks are guard rails and `necro_verify` is the guarantee: it re-runs the frozen contracts.
