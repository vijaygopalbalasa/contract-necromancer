# Contract Necromancer

A coding agent can mark a task done in Kiro when the work does not meet the requirements. Contract Necromancer's Kiro hooks refuse the tick in `tasks.md` until the frozen contracts for that task pass, and each passing task leaves a receipt that anyone can re-run.

```
npx -y github:vijaygopalbalasa/contract-necromancer demo
```

Real output, trimmed (`<tmp>` stands for a temporary folder; the receipt hash differs on each run):

```
Step 2. Send the gate what the Kiro IDE sends when task 4 completes (task_update, status completed).
The gate refused the tick (exit 2).
Contracts failed: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3, R5.4
...
Step 3. Restore the correct src/split.js and send the same call again.
The gate accepted the tick (exit 0).
Receipt: <tmp>/necro-demo-iini5u/.necro/receipts/ledger/769459d7d21a8c77e857ba8d7823ddf7cb954dd08bc3d52958e5744a908db20d.json

Step 4. Re-run the receipt with necro verify.
CONFIRMED 769459d7d21a8c77e857ba8d7823ddf7cb954dd08bc3d52958e5744a908db20d.
Step 5. Change src/split.js in the copy and verify the same receipt again.
MISMATCH. Files changed: src/split.js.

Step 6. Change src/split.js so it is right only under the test runner (it keeps the extra cents only when NODE_TEST_CONTEXT is set).
Run the contracts, then run the ledger on party.txt outside the test runner.
The contracts pass (18 of 18), because they run under the test runner.
The ledger stopped with a ContractViolation (exit 1).
ContractViolation: R5.1 splitExpense: the shares of 3225 cents add up to 3224 cents. The ledger printed nothing because ...
```

- Live receipt viewer: https://vijaygopalbalasa.github.io/contract-necromancer/
- Demo video: https://youtu.be/TYrSyhIYqlk
- Used on a real project: [a fix in Judge Protocol, gated end to end](case-studies/judge-api-errors/README.md), where the gate refused a half-done tick

[![Tests and receipts](https://github.com/vijaygopalbalasa/contract-necromancer/actions/workflows/test.yml/badge.svg)](https://github.com/vijaygopalbalasa/contract-necromancer/actions/workflows/test.yml)

## What the demo does

Requires Node.js 24 or newer, and git: npx needs git to fetch a `github:` package. No Kiro, no npm account, no setup. It takes
under a minute, including the download. The command copies the
Pumpkin Ledger example into a new folder under your temporary directory and prints that path. In the copy it plants a rounding
bug, sends the gate the `task_update` call the Kiro IDE sends when task 4 completes, and shows the gate refusing the tick with
the names of the contracts the bug breaks. It then restores the correct code, sends the call again, and shows the gate accepting
it and writing a receipt. It then runs `necro verify` on the receipt (`CONFIRMED`), changes `src/split.js`, and verifies again
(`MISMATCH`). A last step makes `src/split.js` right only under the test runner: the contracts pass, and the ledger run on a
party stops with a `ContractViolation` (see [Runtime postconditions](#runtime-postconditions)). It exits 0 only if all five
things happened, and otherwise exits 1 and names the step that did not. From a clone, run `node bin/necro.js demo`.

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

Kiro built this app under the gate. Each task it ticked left a receipt in `.necro/receipts/ledger/`. Re-run the newest
one, from task 9 (run `necro verify` from the folder that holds the spec's `.necro/`, here `examples/pumpkin-ledger`):

```
node ../../bin/necro.js verify .necro/receipts/ledger/2c6a247bf4ddaa3cdbedf06e5abf719cf6da88bdf12a86df1097c26264811f71.json
CONFIRMED 2c6a247bf4ddaa3cdbedf06e5abf719cf6da88bdf12a86df1097c26264811f71.
```

The older receipts print `SUPERSEDED`: they were written before task 9 added contracts and a person froze the spec again,
so they describe an earlier freeze, not today's code.

See the gate refuse a tick, with no Kiro install. Work in a scratch copy of the example, so nothing in the repository
changes. From the repository root (`cd ../..` if you are still in the example), copy `examples/pumpkin-ledger` to a temporary folder, plant the bug from the demo video
(each share rounded, so cents are lost), reopen task 4, and send the gate the same `task_update` call the Kiro IDE sends
when you press "Start task" and it finishes:

```
repo=$PWD
scratch=$(mktemp -d)
cp -R examples/pumpkin-ledger "$scratch/ledger" && cd "$scratch/ledger"
perl -pi -e 's/Math\.floor\(cents \/ n\)/Math.round(cents \/ n)/; s/const extra = cents % n;/const extra = 0;/' src/split.js
perl -pi -e 's/^- \[x\] 4\./- [ ] 4./' .kiro/specs/ledger/tasks.md
echo '{"hook_event_name":"preToolUse","tool_name":"task_update","tool_input":{"tasksFilePath":".kiro/specs/ledger/tasks.md","taskId":"4. Split one expense to the cent (Req 2.1)","status":"completed"}}' | node "$repo/bin/necro.js" hook pre; echo "exit $?"
```

`taskId` is the full text of the task line after the checkbox, as the Kiro IDE sends it and as `necro demo` sends it.
The gate prints `Contracts failed:` and names the contracts the bug breaks (R2.1, R2.2, R3.1, R4.1, R4.2 and the
property contracts R5.1 to R5.4), then exits 2, which is how a Kiro
hook refuses a tool call. Undo the bug and run the `echo` line again: exit 0, and a new receipt appears in
`.necro/receipts/ledger/` of the copy.

```
cp "$repo/examples/pumpkin-ledger/src/split.js" src/split.js
```

Delete the scratch copy when you are done. The example in the repository was never touched.

```
cd "$repo" && rm -rf "$scratch"
```

Then run the unit tests of the tool itself from the repository root:

```
npm test
```

## How it works

1. You write `requirements.md` for a spec in EARS form (`WHEN ... THE SYSTEM SHALL ...`).
2. Kiro drafts the contracts under `contracts/<spec>/`, as files named `*.contract.test.js`. Each contract is one test named after its criterion (`R2.1 ...`). A person reviews them.
3. `necro freeze <spec>` locks `requirements.md` and the contracts by hash. After that, the hooks stop edits to them.
4. While Kiro builds, the hooks watch each tool call:
   - `PreToolUse` blocks a tick with exit code 2 and names the failing contracts. A tick is an edit of `tasks.md` or the Kiro IDE's `task_update` tool with status `completed`.
   - `PostToolUse` restores a frozen file that a command changed, and undoes a tick that the contracts do not support.
   - `Stop` reports, for each frozen spec, the tasks ticked, the receipts written, and the contracts failing now, then puts back to `[ ]` every ticked task that `necro audit` does not call `ok`.
   - `PostTaskExec` does the same after Kiro finishes a spec task, whatever the task run did.
5. Each tick that passes writes a receipt to `.necro/receipts/<spec>/<hash>.json`. `necro verify` re-runs it and prints `CONFIRMED` or `MISMATCH`.

A tick needs the contracts for the criteria listed on the ticked task, such as `(Req 1.1, 1.4)`, as recorded when the spec was frozen. It needs every contract when the task is the last unticked one, when the lock does not know the task, when the task line was edited after the freeze, or when the task lists no criteria that have a contract. A spec that is not frozen refuses every tick.

## Use it in your project

```
node <path>/bin/necro.js init
```

`init` writes `.kiro/hooks/necromancer.json`, `.kiro/steering/necromancer.md` and a custom Kiro agent,
`.kiro/agents/necromancer.json`, into the project. The agent carries the same hooks and adds Kiro permission rules that
deny a shell command running `necro freeze` and any write under `.necro/`, so Kiro's own permission engine refuses them
before a hook runs. Start it with `kiro-cli chat --agent necromancer`. In a live test with the hooks and the steering
removed, Kiro answered "A permission rule in this environment blocks any shell command matching `necro.js freeze`" and the
lock stayed unchanged (`.kiro/build-log/agent-live-test.md`). Below, `necro` stands for `node <path>/bin/necro.js`.

`necro init` writes hook commands with the absolute path of the `node` that ran it and of `bin/necro.js`, so they work
when Kiro is started from the Dock and has no shell `PATH`. After `init`, trust the workspace in Kiro and quit and
reopen Kiro (Cmd+Q on macOS); Kiro runs hooks only in a trusted workspace. If you move the install or switch Node
versions, delete `.kiro/hooks/necromancer.json` and run `necro init` again.

## Catch a tick however it got there

The gate sees a tick only when it goes through a tool call the hooks can read. Kiro's "Run all tasks" and its
sub-agents can mark a task done after a failed or killed run (see
[kirodotdev/Kiro#11786](https://github.com/kirodotdev/Kiro/issues/11786)), and an edit made outside Kiro never reaches the
hooks. `necro audit` checks every ticked task after the fact:

```
necro audit             # all frozen specs
necro audit <spec>      # one spec
```

It lists each ticked task of a frozen spec with one verdict, and exits 0 only if every ticked task is `ok`:

- `ok`: every contract the task requires passes now, and either the gate wrote a receipt for that task id (under any
  freeze of the spec) or the task was already ticked when a person last froze the spec.
- `no receipt`: no such receipt exists. This is what a tick made by editing `tasks.md` directly looks like.
- `failing`: a contract the task requires fails now. The contract names are listed.

`audit` changes no file, so it runs in CI and on a fresh clone. A lock written by an older version of `necro` does not
record which tasks were ticked at the freeze, so its already-ticked tasks show `no receipt` until a person freezes the
spec again.

The `Stop` and `PostTaskExec` hooks use the same check and undo what it finds: each ticked task that is not `ok` goes
back to `[ ]` in `tasks.md`, and stderr says which task and why. Kiro documents no input for the `PostTaskExec` trigger,
so `necro hook posttask` ignores its input and audits the project it runs in. `necro init` writes the hook into
`.kiro/hooks/necromancer.json` and the custom agent.

The two hooks audit only the tasks ticked now that were not ticked when a person last froze the spec, and run only the
contract files those tasks require, so they stay inside the hooks' 300 second limit on a large project (a full
`necro audit` of this repository takes about 250 seconds). When no task was ticked since the freeze, `PostTaskExec` runs
no contract, and `Stop` still runs every contract once for its summary of the contracts failing now. When it ran only some,
the summary says how many. `necro audit` still checks every ticked task, so run it in CI.

Receipts are files in the project, so an agent able to write files can add one. A forged receipt can only make
`necro audit` accept a task whose required contracts pass now: it can fake where a tick came from, not whether the work
holds.

To run the audit in CI, add this step to a workflow after the checkout step:

```yaml
- name: Audit ticked tasks
  run: npx -y github:vijaygopalbalasa/contract-necromancer audit
```

## Runtime postconditions

A contract that runs under a test runner only proves the code right while the test runner is watching. Eiffel's `ensure`
clause did more: a routine's postcondition was checked on every call, in production too. `src/runtime.js` brings that to a
frozen spec. An independent review got a `CONFIRMED` receipt for code that looked for the test runner
(`process.env.NODE_TEST_CONTEXT`) and kept the extra cents of a split only there. Every contract passed, and
`splitExpense(100, ['a', 'b', 'c'])` returned 99 cents outside tests.

You write `contracts/<spec>/postconditions.js`: for each function, a criterion ID and a check. The check gets `(args, result)`
and passes by returning `true`; a string it returns is the reason it failed. Your entry point wraps the module with
`guard(exports, postconditions)`, which returns the exports with those functions wrapped:

```js
import * as splitModule from '../src/split.js';
import { guard } from '../src/runtime.js';
import { splitPostconditions } from '../contracts/ledger/postconditions.js';

const { splitExpense } = guard(splitModule, splitPostconditions);
// splitExpense(100, ['a', 'b', 'c']) now throws:
// ContractViolation: R5.1 splitExpense: the shares of 100 cents add up to 99 cents
```

`guard` reads no environment variable and never looks for a test runner, so code under test cannot switch it off.
`src/runtime.js` has no dependencies and no imports: copy it into your project, as `examples/pumpkin-ledger/src/runtime.js`
does. Freezing the spec locks `postconditions.js` with it, like a contract file. To lock the entry point that applies the guard
(and your copy of `runtime.js`), list them under `"frozen"` in `.kiro/specs/<spec>/runners.json`. A file that holds only
`{ "frozen": ["bin/ledger.js", "src/runtime.js"] }` is enough, with no runner patterns.

The cost is a check on every call of a guarded function, in production and not only in tests. Keep each check cheap (the
ledger's checks walk the result once) and guard the functions where a wrong answer costs something. A check runs after the
function returns, so it can stop a wrong result from being used but cannot undo what the function already did.

What this catches that tests cannot: code that behaves one way under a test runner and another way outside it, and real
inputs that no contract tried. What it does not: a wrong or missing criterion, and calls inside a module to its own functions,
which skip the wrapper. `bin/ledger.js` therefore also splits every expense through the guarded `splitExpense` before it
computes balances. `necro demo` ends with this case: it changes `src/split.js` to keep the extra cents only when
`NODE_TEST_CONTEXT` is set, the contracts pass, and the ledger run on `party.txt` stops with the `ContractViolation`.

## MCP server and Kiro power

`necro mcp` serves the Model Context Protocol over stdio with three tools and no dependencies: `necro_status` (for each
task, the contracts that ticking it requires and whether each passes now), `necro_check` and `necro_verify`. There is no
tool to freeze a spec, edit a frozen file or tick a task. In a live Kiro CLI session Kiro called `@necro/necro_status`
and listed every contract task 4 of Pumpkin Ledger needs, with its result (`.kiro/build-log/mcp-live-test.md`).

`power/` packages the workflow as a Kiro power (Agent Plugins format): `plugin.json`, `mcp.json` that starts `necro mcp`,
and a skill, `skills/contract-necromancer/SKILL.md`, that teaches the workflow. Put `necro` on your PATH
(`npm install -g github:vijaygopalbalasa/contract-necromancer`, or `npm link` from a clone), then install the power with
`kiro-cli powers install ./power` or, in the IDE, Powers > Add Custom Power > Import power from GitHub.

## Contracts in other languages

Contracts are JavaScript by default. A spec can hold contracts in any test framework that writes a JUnit XML report.
Add `.kiro/specs/<spec>/runners.json`, which maps a file-name pattern in `contracts/<spec>/` to a command:

```json
{
  "test_*_contract.py": "python3 -P -m pytest {file} --junitxml={report} -q -p no:cacheprovider",
  "sources": ["app/**/*.py"],
  "frozen": ["conftest.py", "pytest.ini"]
}
```

The command runs without a shell, in the project folder. `{file}` and `{report}` are replaced in one pass, `{report}` by
a path in a new temporary folder. Results come only from that report, never from printed output. A testcase named
`R<n>.<m> ...` is the contract for that criterion. pytest must be installed for the Python example.

The command runs under these rules:

- It must exit with status 0. A non-zero status fails the file, whatever the report says. That also means one failing
  test in a file fails the file: keep the contracts of different tasks in different files.
- It may run for 240 seconds. Past that, the file fails and the command and its child processes are killed. The same
  limit applies to JavaScript contract files. `NECRO_RUNNER_TIMEOUT_MS` can lower it for one run, never raise it.
- It gets a fresh, empty `PYTHONPYCACHEPREFIX` folder and `PYTHONDONTWRITEBYTECODE=1`, so compiled files written earlier
  cannot stand in for changed source.
- `"sources"` lists globs, relative to the project root, of the files the contracts exercise. The receipt pins the files
  that match, like the imports of a JavaScript contract, and `necro verify` prints `MISMATCH` when one changes.
- `"frozen"` lists globs of files that decide how the framework runs, such as `conftest.py` and `pytest.ini`. They are
  locked with the spec like the contracts: the hooks put them back if an edit changes them, the contracts fail while
  one differs from the lock, and receipts pin them. A glob that matches no file is refused when you freeze, so create
  the file first (an empty one is enough).
- `*` and `?` stay inside one name, `**` stands for any number of folders. Links, `.git`, `node_modules` and
  `__pycache__` are skipped.

Use `python3 -P` (Python 3.11 or newer) in the command. Without it, `python3 -m pytest` puts the project folder first on
the import path, and a `pytest.py` written there stands in for pytest. With `-P`, a contract that imports the code under
test needs the path set in the contract file or in `PYTHONPATH`.

## Commands

```
necro init              # write the Kiro hooks and steering file into a project
necro freeze <spec>     # lock requirements.md and the contracts of a spec
necro check <spec>      # run every frozen contract now and write a receipt, without ticking a task
necro audit [spec]      # list every ticked task as ok, no receipt or failing; exit 0 only if all are ok
necro verify <receipt>  # re-run a receipt: CONFIRMED, MISMATCH or SUPERSEDED
necro mcp               # serve necro_status, necro_check and necro_verify over MCP (stdio)
necro demo              # show the gate refuse a false "done", accept the fix and re-check the receipt
```

`necro check <spec>` needs a frozen spec. It prints `pass` or `fail` for each contract, writes a receipt to
`.necro/receipts/<spec>/` with `task` set to null and every contract required, and exits 0 when all pass or 1 when any
fails (the receipt is written either way). It does not touch `tasks.md`. Use it to publish a receipt for the commit you
just pushed.

## Where the idea comes from

In 1986 Bertrand Meyer's Eiffel language made every routine state its contract: preconditions, postconditions and
invariants that the program checked itself. Design by Contract answered "who decides the work is correct?" before
anyone wrote the code. It stayed a niche idea, and everyday code kept tests instead. This project raises it
for coding agents, where the question matters again. Kiro specs already have EARS acceptance criteria, but nothing
checked them at the moment a task is ticked. Here each criterion gets an executable contract (the postcondition), and a
person freezes the contracts.

## Demo apps, built by Kiro under the gate

Both apps have their own spec, frozen contracts, receipts and unit tests. A person wrote the requirements. Kiro drafted the design, the tasks and the contracts, and a person reviewed and froze them. Kiro then wrote the code.

**Pumpkin Ledger** (`examples/pumpkin-ledger`) is a command line tool. It splits shared party costs to the exact cent and settles them in few payments.

- Tasks and requirements: `examples/pumpkin-ledger/.kiro/specs/ledger/`. Frozen contracts: `examples/pumpkin-ledger/.necro/lock.json`. Receipts: `examples/pumpkin-ledger/.necro/receipts/ledger/`.
- Property-based contracts (R5.1 to R5.5, task 9): each runs on 300 parties from a seeded generator with no dependencies,
  and on failure prints the seed and the smallest failing party. Kiro planted seven bugs in a scratch copy (rounding,
  lost cents, a dropped payment, ignored `split` lists, unsorted extra cents, a random tie-break, split payments) and a
  property caught each one; 45,000 more parties found no bug in the real code (`.kiro/build-log/build-ledger-t9.txt`).
- Run: `cd examples/pumpkin-ledger`, then `node bin/ledger.js party.txt`, or add `--json`.
- A real moment: Kiro tried to tick task 1 first. The gate refused, because the contracts for its criteria 1.1 and 1.4 need the line parser, which is a later task. Kiro built the rest of the code, and then every tick passed (`.kiro/build-log/build-ledger.txt`).

**Night Shift** (`examples/night-shift`) is a web page. It plans a Halloween watch party across time zones and flags guests who would be up in the dead of night (00:00 up to 06:00 local), with daylight-saving gaps and overlaps handled.

- Tasks and requirements: `examples/night-shift/.kiro/specs/planner/`. Frozen contracts: `examples/night-shift/.necro/lock.json`. Receipts: `examples/night-shift/.necro/receipts/planner/`.
- Run: serve the folder, for example `python3 -m http.server -d examples/night-shift`, and open `http://localhost:8000/site/`. The page opens with a filled form and a working example (Halloween 2026, 20:00 in
  New York, guests in London, Kolkata, Tokyo and Kathmandu); change the form and the link updates, so a plan can be shared
  as a link such as `?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata`.
- A real moment: Kiro tried to tick task 1 early and the gate refused, because task 1 covers criteria 1.4 and 2.1, and contracts for those need code from later tasks (`.kiro/build-log/build-nightshift.txt`).
- The receipt for task 9 (`4821ef86...`) and the newest `necro check` receipt (`a3d2bf63...`) print `CONFIRMED`. The other receipts in `examples/night-shift/.necro/receipts/planner/` print `SUPERSEDED`, because task 9 added a contract and the spec was frozen again.

Their hook files use `node ../../bin/necro.js`, so they work where `node` is on your `PATH`. If Kiro is started from the Dock, delete the example's `.kiro/hooks/necromancer.json` and run `node ../../bin/necro.js init` from that folder.

## How Kiro built this

A person wrote the requirements and, later in the build, some of the task descriptions. Kiro drafted the design, the first task lists and the contracts, and wrote all the code, task by task. A person reviewed the contracts and froze them. Twice, a person made a one-line fix to a frozen contract that conflicted with a revised requirement, and then froze again.

- Specs in `.kiro/specs/`:
  - `necro-core`: the tool.
  - `receipt-viewer`: the static page in `site/`.
  - The requirements and tasks of each spec are in its `requirements.md` and `tasks.md`. The frozen contracts of each spec are listed in `.necro/lock.json`, and its receipts are in `.necro/receipts/<spec>/`. These numbers change as the project grows, so read them there.
- Steering in `.kiro/steering/`: `product.md`, `structure.md`, `tech.md`, and `necromancer.md`, which tells Kiro not to edit frozen files.
- A custom agent in `.kiro/agents/necromancer.json` (task 21): the gate's hooks plus Kiro permission rules.
- Hooks in `.kiro/hooks/`: `necromancer.json` is the gate (`PreToolUse`, `PostToolUse` and `Stop` calling `node bin/necro.js hook ...`). `session-log.json` appends the tool and path of each Kiro tool call to `.kiro/build-log/sess_*.jsonl`. For shell commands it keeps only program names.
- Build logs in `.kiro/build-log/`: `build-*.txt` are Kiro's session output for each piece of work.

The tool did not gate its own first tasks. The early tasks of `necro-core` were built before that spec was frozen, and they have no receipts. After the first freeze, the tool gated its own development: Kiro drafted the contracts from the requirements, a person reviewed and froze them, and the later tasks were ticked through the gate. The receipt viewer was built under the gate from its first task.

Moments from the logs and the git history:

- Kiro ticked task 8c without building it, before the gate existed. A review found it, and the commit history reopens the task (`b63a530`, `a7283a3`) and redoes it (`8c4f996`). That is the failure this tool is built to catch.
- Kiro finished tasks 16 and 17 of `necro-core`, and the gate refused each tick with "Spec 'necro-core' is not frozen". Kiro left the boxes unticked and did not retry (`build-t16.txt`, `build-t17.txt`). After the freeze, the task 17 tick went through and wrote a receipt.
- An outside review found that nothing stopped the agent from running `necro freeze` itself, which rewrites the lock
  that `verify` trusts, and the steering file even suggested it. Tasks 19 and 20 close it, built by Kiro under the
  gate: the PreToolUse hook refuses a shell command that runs `freeze`, and after any shell command the PostToolUse hook
  puts `.necro/lock.json` back byte for byte, however the command was spelled. A person froze the new contracts
  (R3.14, R3.15, R6.8, R8.8), then the ticks went through (`build-t19.txt`, `build-t20.txt`).
- Old receipts now print `SUPERSEDED` when their spec was frozen again later, instead of `MISMATCH` (task 19). A
  receipt prints `CONFIRMED` only while its spec has not been frozen again since it was written, so most older receipts print `SUPERSEDED`.
- The receipt viewer: its tasks were ticked through the gate and left receipts in `.necro/receipts/receipt-viewer/`. `build-viewer.txt` is the log of its first build session and records that every tick in it was accepted by the gate.

## Limits

A shell command or the contract code itself can change any file on disk, including `.necro/`. The hooks are guard
rails: they stop the agent's ordinary edits and undo a task tick that the contracts do not support, but they cannot stop
a determined process that runs with your permissions. The hooks keep their own records (the task state and the copy of the lock they restore) under
`.necro/state/`, and a command that rewrites those too gets past them.

The guarantee is `necro verify`. It re-runs the frozen contracts from the lock and compares hashes and results with the
receipt, so a false "done" shows up as `MISMATCH`. `verify` trusts the lock file on disk, and `necro freeze` rewrites it,
so freezing is a person's job: commit `.necro/lock.json` with the contracts, and before you trust a receipt, check that
`git diff` shows no change to the lock or the contracts. Run `necro verify` in CI.

### What runner contracts cannot defend against

Code under test runs inside the test framework's own process. It can tamper with that process: write the report from an
exit handler, exit early with status 0, or patch the framework. The exit status, the time limit and the locked files make
that harder, not impossible. The gate also trusts the language environment as much as the test framework does: the
installed packages and the interpreter. An agent that can install a package that the framework loads on its own, or
replace the interpreter, can make a failing run look like a pass. Run `necro verify` on a machine you control, from a
clean checkout and a clean environment, before you trust a receipt for code in another language.

## Receipt viewer

`site/` is a static page that opens a receipt, lists each contract with PASS or FAIL, recomputes the receipt hash in the
browser, and shows the command to re-run the receipt. It has no server, no build step and no dependencies.

- Address: `https://vijaygopalbalasa.github.io/contract-necromancer/`. `.github/workflows/pages.yml` deploys `site/`;
  the repository owner sets Settings > Pages > Source to "GitHub Actions" once.
- Open a receipt directly with `?receipt=<raw url>`, where the URL is the Raw link of a receipt on
  raw.githubusercontent.com, for example `https://vijaygopalbalasa.github.io/contract-necromancer/?receipt=https://raw.githubusercontent.com/vijaygopalbalasa/contract-necromancer/main/.necro/receipts/SPEC/HASH.json`.
  Other hosts are refused. You can also paste the JSON or pick the file.
- Re-run command: it clones the repository at the receipt's commit, takes the receipt file from the default branch
  (a receipt is written after the commit it names), then clones the official verifier from
  `vijaygopalbalasa/contract-necromancer` at one fixed commit (`VERIFIER_COMMIT` in `site/lib/repo.js`) into
  `.necro-verifier`, defines `necro` as `node .necro-verifier/bin/necro.js` for that shell, and runs `necro verify`.
  The verifier never comes from the repository being verified. It needs Git and Node.js 24, no install, and writes only
  inside the `necro-check` folder it clones. The receipt must be on the default branch of the repository.
  Verifying runs the project's own contracts, which is code from that repository: run it only for a repository you are
  willing to run.
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
