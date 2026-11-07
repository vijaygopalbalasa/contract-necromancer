# Contract Necromancer

In 1986 Bertrand Meyer's Eiffel language made every routine state its contract: preconditions, postconditions and
invariants that the program checked itself. Design by Contract answered "who decides the work is correct?" before
anyone wrote the code. It stayed a niche idea, and everyday code kept tests instead. This project raises it
for coding agents, where the question matters again.

A coding agent can mark a task done when the work is not done. Kiro specs already have EARS acceptance criteria, but nothing checks them at the moment a task is ticked. Contract Necromancer gives each criterion an executable contract (the postcondition), a person freezes the contracts, Kiro hooks refuse the tick until the frozen contracts pass, and every passing task gets a receipt that anyone can re-run.

## Try it in a minute

Requires Node.js 24 or newer. There is no `npm install`.

```
git clone https://github.com/vijaygopalbalasa/contract-necromancer.git
cd contract-necromancer/examples/pumpkin-ledger
node bin/ledger.js party.txt
```

`party.txt` holds a few shared costs from a Halloween party. The ledger prints each person's balance and the payments that settle them:

```
Name   Paid  Share  Balance
Ann   48.60  53.17    -4.57
Bob   48.24  39.46     8.78
Cy    61.00  39.46    21.54
Dee   27.40  53.15   -25.75
Dee pays Cy 21.54
Ann pays Bob 4.57
Dee pays Bob 4.21
```

Kiro built this app under the gate. Each task it ticked left a receipt in `.necro/receipts/ledger/`. Re-run one:

```
node ../../bin/necro.js verify .necro/receipts/ledger/e6371c6c38186f7db271dc2b9e943bc0d9b216b34d4ccef0a2ebeb1797165481.json
CONFIRMED e6371c6c38186f7db271dc2b9e943bc0d9b216b34d4ccef0a2ebeb1797165481.
```

See the gate refuse a tick, with no Kiro install. Still in `examples/pumpkin-ledger`, plant the bug from the demo video
(each share rounded, so cents are lost), reopen task 4, and send the gate the same `task_update` call the Kiro IDE sends
when you press "Start task" and it finishes:

```
perl -pi -e 's/Math\.floor\(cents \/ n\)/Math.round(cents \/ n)/; s/const extra = cents % n;/const extra = 0;/' src/split.js
perl -pi -e 's/^- \[x\] 4\./- [ ] 4./' .kiro/specs/ledger/tasks.md
echo '{"hook_event_name":"preToolUse","tool_name":"task_update","tool_input":{"tasksFilePath":".kiro/specs/ledger/tasks.md","taskId":"4","status":"completed"}}' | node ../../bin/necro.js hook pre; echo "exit $?"
```

The gate prints `Contracts failed: R2.1 ..., R2.2 ..., R3.1 ..., R4.1 ..., R4.2 ...` and exits 2, which is how a Kiro
hook refuses a tool call. Undo the bug with `git checkout src/split.js` and run the `echo` line again: exit 0, and a new
receipt appears in `.necro/receipts/ledger/`. Run `git checkout .` and remove the new receipt to clean up.

Then run the unit tests of the tool itself from the repository root:

```
cd ../..
npm test
```

## How it works

1. You write `requirements.md` for a spec in EARS form (`WHEN ... THE SYSTEM SHALL ...`).
2. Kiro drafts the contracts under `contracts/<spec>/`, as files named `*.contract.test.js`. Each contract is one test named after its criterion (`R2.1 ...`). A person reviews them.
3. `necro freeze <spec>` locks `requirements.md` and the contracts by hash. After that, the hooks stop edits to them.
4. While Kiro builds, the hooks watch each tool call:
   - `PreToolUse` blocks a tick with exit code 2 and names the failing contracts. A tick is an edit of `tasks.md` or the Kiro IDE's `task_update` tool with status `completed`.
   - `PostToolUse` restores a frozen file that a command changed, and undoes a tick that the contracts do not support.
   - `Stop` reports, for each frozen spec, the tasks ticked, the receipts written, and the contracts failing now.
5. Each tick that passes writes a receipt to `.necro/receipts/<spec>/<hash>.json`. `necro verify` re-runs it and prints `CONFIRMED` or `MISMATCH`.

A tick needs the contracts for the criteria listed on the ticked task, such as `(Req 1.1, 1.4)`, as recorded when the spec was frozen. It needs every contract when the task is the last unticked one, when the lock does not know the task, when the task line was edited after the freeze, or when the task lists no criteria that have a contract. A spec that is not frozen refuses every tick.

## Use it in your project

```
node <path>/bin/necro.js init
```

`init` writes `.kiro/hooks/necromancer.json` and `.kiro/steering/necromancer.md` into the project. Below, `necro` stands for `node <path>/bin/necro.js`.

`necro init` writes hook commands with the absolute path of the `node` that ran it and of `bin/necro.js`, so they work
when Kiro is started from the Dock and has no shell `PATH`. After `init`, trust the workspace in Kiro and quit and
reopen Kiro (Cmd+Q on macOS); Kiro runs hooks only in a trusted workspace. If you move the install or switch Node
versions, delete `.kiro/hooks/necromancer.json` and run `necro init` again.

## Commands

```
necro init              # write the Kiro hooks and steering file into a project
necro freeze <spec>     # lock requirements.md and the contracts of a spec
necro check <spec>      # run every frozen contract now and write a receipt, without ticking a task
necro verify <receipt>  # re-run a receipt and print CONFIRMED or MISMATCH
```

`necro check <spec>` needs a frozen spec. It prints `pass` or `fail` for each contract, writes a receipt to
`.necro/receipts/<spec>/` with `task` set to null and every contract required, and exits 0 when all pass or 1 when any
fails (the receipt is written either way). It does not touch `tasks.md`. Use it to publish a receipt for the commit you
just pushed.

## Demo apps, built by Kiro under the gate

Both apps have their own spec, frozen contracts, receipts and unit tests. A person wrote the requirements. Kiro drafted the design, the tasks and the contracts, and a person reviewed and froze them. Kiro then wrote the code.

**Pumpkin Ledger** (`examples/pumpkin-ledger`) is a command line tool. It splits shared party costs to the exact cent and settles them in few payments.

- 8 tasks, 13 contracts in 4 files, 27 unit tests, 9 receipts (one per ticked task, plus one from `necro check`).
- Run: `cd examples/pumpkin-ledger`, then `node bin/ledger.js party.txt`, or add `--json`.
- A real moment: Kiro tried to tick task 1 first. The gate refused, because the contracts for its criteria 1.1 and 1.4 need the line parser, which is a later task. Kiro built the rest of the code, and then every tick passed (`.kiro/build-log/build-ledger.txt`).

**Night Shift** (`examples/night-shift`) is a web page. It plans a Halloween watch party across time zones and flags guests who would be up in the dead of night (00:00 up to 06:00 local), with daylight-saving gaps and overlaps handled.

- 8 tasks, 12 contracts in 4 files, 42 unit tests, 9 receipts (one per ticked task, plus one from `necro check`).
- Run: serve the folder, for example `python3 -m http.server -d examples/night-shift`, and open `http://localhost:8000/site/?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata`. The page reads its input from the link.
- A real moment: Kiro tried to tick task 1 early and the gate refused, because task 1 covers criteria 1.4 and 2.1, and contracts for those need code from later tasks (`.kiro/build-log/build-nightshift.txt`).
- Receipts for tasks 1 to 5 print `MISMATCH` today. They were written before the page existed, and they record the page contracts R4.1 to R4.3 as failing. Those contracts pass now. The receipts for tasks 6 to 8 print `CONFIRMED`.

Their hook files use `node ../../bin/necro.js`, so they work where `node` is on your `PATH`. If Kiro is started from the Dock, delete the example's `.kiro/hooks/necromancer.json` and run `node ../../bin/necro.js init` from that folder.

## How Kiro built this

Kiro wrote the code of this repository task by task. A person reviewed the contracts and froze them.

- Specs in `.kiro/specs/`:
  - `necro-core`: the tool. 9 requirements, 26 tasks, 73 contracts in 15 files, 6 receipts.
  - `receipt-viewer`: the static page in `site/`. 8 requirements, 16 tasks, 20 contracts in 8 files, 16 receipts.
- Steering in `.kiro/steering/`: `product.md`, `structure.md`, `tech.md`, and `necromancer.md`, which tells Kiro not to edit frozen files.
- Hooks in `.kiro/hooks/`: `necromancer.json` is the gate (`PreToolUse`, `PostToolUse` and `Stop` calling `node bin/necro.js hook ...`). `session-log.json` appends the tool and path of each Kiro tool call to `.kiro/build-log/sess_*.jsonl`. For shell commands it keeps only program names.
- Build logs in `.kiro/build-log/`: `build-*.txt` are Kiro's session output for each piece of work.

The tool did not gate its own first tasks. Tasks 1 to 16 of `necro-core` were built before that spec was frozen, and they have no receipts. From task 17 on, the tool gated its own development: Kiro drafted 68 contracts from the requirements, a person reviewed and froze them, and tasks 17 to 20 were ticked through the gate. The receipt viewer was built under the gate from its first task.

Moments from the logs and the git history:

- Kiro ticked task 8c without building it, before the gate existed. A review found it, and the commit history reopens the task (`b63a530`, `a7283a3`) and redoes it (`8c4f996`). That is the failure this tool is built to catch.
- Kiro finished tasks 16 and 17 of `necro-core`, and the gate refused each tick with "Spec 'necro-core' is not frozen". Kiro left the boxes unticked and did not retry (`build-t16.txt`, `build-t17.txt`). After the freeze, the task 17 tick went through and wrote a receipt.
- An outside review found that nothing stopped the agent from running `necro freeze` itself, which rewrites the lock
  that `verify` trusts, and the steering file even suggested it. Tasks 19 and 20 close it, built by Kiro under the
  gate: the PreToolUse hook refuses a shell command that runs `freeze`, and after any shell command the PostToolUse hook
  puts `.necro/lock.json` back byte for byte, however the command was spelled. A person froze the new contracts
  (R3.14, R3.15, R6.8, R8.8), then the ticks went through (`build-t19.txt`, `build-t20.txt`).
- Old receipts now print `SUPERSEDED` when their spec was frozen again later, instead of `MISMATCH` (task 19). The
  newest receipt of each spec prints `CONFIRMED`.
- The receipt viewer: 14 tasks were ticked through the gate with a receipt each, and tasks 15 and 16 followed. Its log records that every tick was accepted by the gate (`build-viewer.txt`).

## Limits

A shell command or the contract code itself can change any file on disk, including `.necro/`. The hooks are guard
rails: they stop the agent's ordinary edits and undo a task tick that the contracts do not support, but they cannot stop
a determined process that runs with your permissions.

The guarantee is `necro verify`. It re-runs the frozen contracts from the lock and compares hashes and results with the
receipt, so a false "done" shows up as `MISMATCH`. `verify` trusts the lock file on disk, and `necro freeze` rewrites it,
so freezing is a person's job: commit `.necro/lock.json` with the contracts, and before you trust a receipt, check that
`git diff` shows no change to the lock or the contracts. Run `necro verify` in CI.

## Receipt viewer

`site/` is a static page that opens a receipt, lists each contract with PASS or FAIL, recomputes the receipt hash in the
browser, and shows the command to re-run the receipt. It has no server, no build step and no dependencies.

- Address: `https://vijaygopalbalasa.github.io/contract-necromancer/`. `.github/workflows/pages.yml` deploys `site/`;
  the repository owner sets Settings > Pages > Source to "GitHub Actions" once.
- Open a receipt directly with `?receipt=<raw url>`, where the URL is the Raw link of a receipt on
  raw.githubusercontent.com, for example `https://vijaygopalbalasa.github.io/contract-necromancer/?receipt=https://raw.githubusercontent.com/vijaygopalbalasa/contract-necromancer/main/.necro/receipts/SPEC/HASH.json`.
  Other hosts are refused. You can also paste the JSON or pick the file.
- Honest limit: contracts re-run in Node with `necro verify`. The browser checks hashes, not test runs. MATCH means the
  receipt was not edited. It does not mean the contracts pass today.
- Run it locally: browsers do not load ES modules from `file://`, so serve the folder, for example
  `python3 -m http.server -d site`, then open http://localhost:8000/.
- The file check fetches pinned files from raw.githubusercontent.com, which serves the stored blob. A file kept in Git
  LFS comes back as a pointer file and shows as different.

The page's tests run with `npm test`. Layout at phone width and the clipboard cannot be tested in Node; check them by
hand.

## License

MIT
