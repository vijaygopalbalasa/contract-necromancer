# How it was built

The build history and the idea behind Contract Necromancer, moved out of the [README](../README.md).

## How Kiro built this

A person wrote the requirements and, later, some task descriptions. Kiro drafted the design, the first task lists and the
contracts, and wrote all the code, task by task. A person reviewed the contracts and froze them. When a requirement changed
late, a person made small edits to five frozen contract files and removed two contract files that Kiro had replaced, each in
a commit that says so.

- Specs in `.kiro/specs/`:
  - `necro-core`: the tool.
  - `receipt-viewer`: the static page in `site/`.
  - The requirements and tasks of each spec are in its `requirements.md` and `tasks.md`. The frozen contracts of each spec
    are listed in `.necro/lock.json`, and its receipts are in `.necro/receipts/<spec>/`. These numbers change as the project
    grows, so read them there.
- Steering in `.kiro/steering/`: `product.md`, `structure.md`, `tech.md`, and `necromancer.md`, which tells Kiro not to edit
  frozen files.
- A custom agent in `.kiro/agents/necromancer.json` (task 21): the gate's hooks plus Kiro permission rules.
- Hooks in `.kiro/hooks/`: `necromancer.json` is the gate (`PreToolUse`, `PostToolUse` and `Stop` calling
  `node bin/necro.js hook ...`). `session-log.json` appends the tool and path of each Kiro tool call to
  `.kiro/build-log/sess_*.jsonl`. For shell commands it keeps only program names.
- Build logs in `.kiro/build-log/`: `build-*.txt` are Kiro's session output for each piece of work.

The tool did not gate its own first tasks. The early tasks of `necro-core` were built before that spec was frozen, and they
have no receipts. After the first freeze, the tool gated its own development: Kiro drafted the contracts from the
requirements, a person reviewed and froze them, and the later tasks were ticked through the gate. The receipt viewer was
built under the gate from its first task.

Moments from the logs and the git history:

- Kiro ticked task 8c without building it, before the gate existed. A review found it, and the commit history reopens the
  task (`b63a530`, `a7283a3`) and redoes it (`8c4f996`). That is the failure this tool is built to catch.
- Kiro finished tasks 16 and 17 of `necro-core`, and the gate refused each tick with "Spec 'necro-core' is not frozen".
  Kiro left the boxes unticked and did not retry (`build-t16.txt`, `build-t17.txt`). After the freeze, the task 17 tick
  went through and wrote a receipt.
- An outside review found that nothing stopped the agent from running `necro freeze` itself, which rewrites the lock
  that `verify` trusts, and the steering file even suggested it. Tasks 19 and 20 close it, built by Kiro under the
  gate: the PreToolUse hook refuses a shell command that runs `freeze`, and after any shell command the PostToolUse hook
  puts `.necro/lock.json` back byte for byte, however the command was spelled. A person froze the new contracts
  (R3.14, R3.15, R6.8, R8.8), then the ticks went through (`build-t19.txt`, `build-t20.txt`).
- Old receipts now print `SUPERSEDED` when their spec was frozen again later, instead of `MISMATCH` (task 19). A
  receipt prints `CONFIRMED` only while its spec has not been frozen again since it was written, so most older receipts print
  `SUPERSEDED`.
- The receipt viewer: its tasks were ticked through the gate and left receipts in `.necro/receipts/receipt-viewer/`.
  `build-viewer.txt` is the log of its first build session and records that every tick in it was accepted by the gate.

Whether the gate changes what Kiro does is measured separately: see the [experiment](../experiments/README.md).

## Where the idea comes from

In 1986 Bertrand Meyer's Eiffel language made every routine state its contract: preconditions, postconditions and
invariants that the program checked itself. Design by Contract answered "who decides the work is correct?" before
anyone wrote the code. It stayed a niche idea, and everyday code kept tests instead. This project raises it
for coding agents, where the question matters again. Kiro specs already have EARS acceptance criteria, but nothing
checked them at the moment a task is ticked. Here each criterion gets an executable contract (the postcondition), and a
person freezes the contracts.
