# Contract Necromancer

Design by Contract, from Eiffel (1986), raised for coding agents.

A coding agent can mark a task done in Kiro when the work does not meet the requirements. Contract Necromancer's Kiro hooks refuse the tick in `tasks.md` until the frozen contracts for that task pass, and each passing task leaves a receipt you can re-run.

![Two frames of a real Kiro session on Nov 8: the gate's PreToolUse hook blocks the edit to tasks.md, then Kiro says it could not mark task 4 complete](.kiro/build-log/film/take6-refusal.webp)

*Real Kiro session, recorded Nov 8, not a simulation: the gate's PreToolUse hook blocks the edit to `tasks.md`, then Kiro says it could not mark task 4 complete.*

**How Kiro built this.** I wrote the requirements and some task descriptions. Kiro drafted the designs, task lists and
contracts, and wrote all the code, task by task; I reviewed the contracts and froze them. From `necro-core` task 17 on, and
for every task of the page, the gate held Kiro's own ticks. The specs are in [`.kiro/specs`](.kiro/specs), the gate in
[`.kiro/hooks`](.kiro/hooks), the steering in [`.kiro/steering`](.kiro/steering), the custom agent in
[`.kiro/agents`](.kiro/agents), the Kiro power in [`power/`](power), and the build sessions' logs in
[`.kiro/build-log`](.kiro/build-log). Who wrote what: [how it was built](docs/how-it-was-built.md).

**Used on a real fix.** In Judge Protocol, a live project of mine, Kiro fixed two real bugs in the API under the gate: an
error response could hand a caller the chain RPC URL (which can carry a provider key), and an evidence route could serve
the wrong file. The gate refused Kiro's first tick, because only one of the two error paths logged the full error and the
contract asks for both. The fix then passed all 6 frozen contracts and was merged
([PR #29](https://github.com/vijaygopalbalasa/judge-protocol/pull/29), [case study](case-studies/judge-api-errors/README.md)).
Re-check it:

```
git clone https://github.com/vijaygopalbalasa/judge-protocol && cd judge-protocol/judge-service && npm ci
npx -y github:vijaygopalbalasa/contract-necromancer verify .necro/receipts/api-errors/bc99f504b6460d31fb279cb986dfc70e4e65c70598518ec011f77fb9ea8a88f9.json
```

It prints `CONFIRMED`. Without `npm ci` it prints `INCOMPLETE` and says to run `npm ci`.

**Used on a project I do not own.** On Starlette ([Kludex/starlette#3793](https://github.com/Kludex/starlette/issues/3793),
a 405 `Allow` header whose order changed with the hash seed), the gate installed in a fresh clone in seconds and ran Kiro's
pytest contracts; my review of those contracts closed a gap that would have let a half fix pass, and the receipt re-checks
as `CONFIRMED` from an empty folder ([case study](case-studies/starlette-allow-header/README.md)). Kiro got the one-line fix
right first time, so this case shows no refusal; the same fix was already proposed upstream, so it was not sent there.

**[Result](experiments/README.md):** on a task that cannot honestly be finished, Kiro marked it done in 11 of 11 runs without the gate and 0 of 19 with it, across two models, 3 to 5 runs per cell (a small experiment; every run's log is in `experiments/`); the hook alone was enough. Under a "do whatever it takes" prompt, one gated run of six got past the gate by patching JavaScript built-ins; that hole is closed and the cheat is kept as a test.

**Try it in one command** (Node.js 24 and git): `npx -y github:vijaygopalbalasa/contract-necromancer demo`. The gate refuses a planted bug, accepts the fix, the receipt verifies, and code that is right only under the test runner is stopped at runtime. With no install, [the live page](https://vijaygopalbalasa.github.io/contract-necromancer/) has a Try it here button that sends the gate a false done and then the fix, in the browser. Also: the [video](https://youtu.be/TYrSyhIYqlk).

[![Tests and receipts](https://github.com/vijaygopalbalasa/contract-necromancer/actions/workflows/test.yml/badge.svg)](https://github.com/vijaygopalbalasa/contract-necromancer/actions/workflows/test.yml)

## Use it in your project

Needs Node.js 24 or newer. Install once:

```
npm install -g github:vijaygopalbalasa/contract-necromancer
```

In your project's folder:

```
necro init                 # write the Kiro hooks and steering file; trust the workspace, reopen Kiro
necro freeze <spec>        # a person does this, after reading the contracts
necro check <spec>         # run every frozen contract now and write a receipt
necro audit                # check each ticked task after the fact
necro verify <receipt>     # re-run a receipt, exit code after each outcome: CONFIRMED 0 (its results reproduce, failures included), MISMATCH 1, SUPERSEDED 1, INCOMPLETE 2 (a runner or module is missing here), OTHER PROJECT 2
```

Before `freeze`, write `.kiro/specs/<spec>/requirements.md` with numbered acceptance criteria, and one contract per
criterion in `contracts/<spec>/`. A contract's name starts with its criterion ID: `R1.1` is criterion 1 of Requirement 1.
In Node.js, `contracts/<spec>/slug.contract.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../../src/slugify.js';

test('R1.1 slugify lowercases the text', () => {
  assert.equal(slugify('Hello'), 'hello');
});
```

Contracts run in a Node.js process started with `--frozen-intrinsics`, so code under test cannot patch `String.prototype.split`
or `Array.prototype.map` to change what your assertions see; the attempt makes the contract fail. A result can still lie
through its own methods, for example a subclass of `String` with a `split` that hides a line. So compare plain values: wrap
the result in `plain()` from `src/plain.js` (it has no imports; copy it, or import it from the installed package) before you
call a method on it, and `plain(result)` gives back primitive strings, plain arrays and objects, and Maps as plain copies.

```js
import { plain } from '../../src/plain.js';

test('R3.3 a square party says All square.', () => {
  const lines = plain(renderText(balances, [])).split('\n');
  assert.equal(lines.at(-1), 'All square.');
});
```

A Python contract needs pytest, Python 3.11 or newer, and `.kiro/specs/<spec>/runners.json`:

```json
{
  "test_*_contract.py": "python3 -P -m pytest {file} --junitxml={report} -q --noconftest -p no:cacheprovider",
  "sources": ["slugs/*.py"]
}
```

Then `contracts/<spec>/test_slug_contract.py` (`test_R1_1_...` counts as `R1.1`):

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from slugs.slug import slugify


def test_R1_1_slugify_lowercases_the_text():
    assert slugify("Hello") == "hello"
```

CommonJS and other details: [reference](docs/reference.md#using-it-in-your-project-in-detail).

## Try it in one command

Needs Node.js 24 or newer and git.

```
npx -y github:vijaygopalbalasa/contract-necromancer demo
```

It plants a bug in a copy of Pumpkin Ledger. The gate refuses the tick, accepts the fix and writes a receipt; `necro verify`
confirms it, then catches a later change; last, code that is right only under the test runner stops at runtime. Real
output, trimmed (the receipt hash is the same on every run):

```
The gate refused the tick (exit 2).
Contracts failed: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3, R5.4
The gate accepted the tick (exit 0).
CONFIRMED 45dc5916f25671358f56862bc83423dc9b5b3bf89a4e057e2880643ca94bec27.
MISMATCH. Files changed: src/split.js.
Step 6. Change src/split.js so it is right only under the test runner (it keeps the extra cents only when NODE_TEST_CONTEXT is set).
The contracts pass (18 of 18), because they run under the test runner.
The ledger stopped with a ContractViolation (exit 1).
ContractViolation: R5.1 splitExpense: the shares of 3225 cents add up to 3224 cents. ...
```

To try it with no install, open the live page https://vijaygopalbalasa.github.io/contract-necromancer/ and press the Try it here button. It sends the gate a false done and then the fix, in the browser.

## Re-run a receipt

Every passing tick writes a receipt, and `necro verify` re-runs it. It prints one of five words:

| It prints | Meaning | Exit |
|---|---|---|
| `CONFIRMED` | The pinned files and the contract results are the same today. | 0 |
| `MISMATCH` | Something the receipt pinned has changed; it names the files or contracts. | 1 |
| `SUPERSEDED` | The spec was frozen again, or later work under the same freeze changed the code; it says which, and names the newer receipt when there is one. | 1 |
| `INCOMPLETE` | A contract could not run here (for example pytest is not installed, or `npm ci` was not run); it names what is missing, and nothing it could run differed. | 2 |
| `OTHER PROJECT` | The receipt was written in another project; verify it from that project's checkout. | 2 |

Three receipts to try, from a clone of this repository
(`git clone https://github.com/vijaygopalbalasa/contract-necromancer && cd contract-necromancer`):

```
node bin/necro.js verify .necro/receipts/necro-core/1a24cb6dc025da9a0a09db0eea2332ee3120362730ab51ef33226539f9347c1f.json
node bin/necro.js verify .necro/receipts/receipt-viewer/5b11925f3c30c6d9900cece15925c49be56652f215ffdd04ce40dd6df8f54174.json
node bin/necro.js verify examples/pumpkin-ledger/.necro/receipts/ledger/86e6ee251eaacbfb90f621d45fd704e904bca4e803c0a2a644f9ce2f094a5801.json
```

The first is the tool's own: `CONFIRMED` with pytest installed, `INCOMPLETE` naming R13.6 without it. The second is the
page's: `CONFIRMED` with Chrome or Chromium, `INCOMPLETE` naming the missing browser without one. The third needs only
Node.js. Older receipts print `SUPERSEDED`. Re-running all 126 receipts here with pytest and Chrome installed gives 10
`CONFIRMED`, 112 `SUPERSEDED`, 4 `OTHER PROJECT` (the case-study copies) and no `MISMATCH`; without pytest, 5 of the 10
print `INCOMPLETE` instead, and without a browser, the page's 2 newest receipts do.

## See it

- [Live receipt viewer](https://vijaygopalbalasa.github.io/contract-necromancer/), which opens a receipt from a Raw link on `https://raw.githubusercontent.com/vijaygopalbalasa/contract-necromancer/` with `?receipt=`.
- [Demo video](https://youtu.be/TYrSyhIYqlk).
- [Case study](case-studies/judge-api-errors/README.md): a real fix in Judge Protocol, gated end to end; the gate refused a half-done tick, and the fix is merged ([PR #29](https://github.com/vijaygopalbalasa/judge-protocol/pull/29)).
- [Case study](case-studies/starlette-allow-header/README.md): a fix in Starlette, a project I do not own, gated end to end with Python contracts, from a fresh `necro init`.
- Examples with their own frozen contracts and receipts: [Pumpkin Ledger](examples/pumpkin-ledger), [Night Shift](examples/night-shift), [Leap Age](examples/leap-age) (Python).
- [Experiment](experiments/README.md), [reference](docs/reference.md), [how it was built and who wrote what](docs/how-it-was-built.md), [limits](docs/limits.md).

## How it works

1. A person writes `requirements.md` in EARS form. Kiro drafts one contract per criterion; a person reviews and freezes them.
2. `necro freeze <spec>` locks both by hash, and the hooks stop edits to them.
3. `PreToolUse` refuses a tick in `tasks.md` (exit code 2) and names the failing contracts, until the task's contracts pass. `PostToolUse`, `Stop` and `PostTaskExec` restore frozen files and untick unsupported work.
4. Each passing tick writes a receipt to `.necro/receipts/<spec>/`. `necro verify` re-runs it.

### Runtime postconditions

A contract proves the code right only while the test runner watches. Eiffel's `ensure` checked a postcondition on every
call. Write `contracts/<spec>/postconditions.js`; `guard(exports, postconditions)` from `src/runtime.js` wraps the
functions so a wrong result throws a `ContractViolation`. It reads no environment variable such as `NODE_TEST_CONTEXT`, so
code under test cannot switch it off. The cost is a check on every call, and it cannot undo what a function already did. The check gets a deep copy of the arguments
taken before the call, so a function that changes its own arguments cannot make its check agree with a wrong result. The
ledger also guards `parseLedger`: its check reads the input text again and compares each line's payer, amount in cents and
split list, because every later check takes the parsed amounts as the truth.
Runtime postconditions protect only the outputs they check, so guard every function whose result reaches a user. The
ledger guards the balances, the payments and both reports it prints. The demo's step 6 shows one cheat among many: a
function with no postcondition can still lie. [More](docs/reference.md#runtime-postconditions).

### Audit in CI

`necro audit` checks every ticked task after the fact and changes no file. Python contracts need pytest, or the task shows `cannot run`. The CI step:

```yaml
- name: Audit ticked tasks
  run: npx -y github:vijaygopalbalasa/contract-necromancer audit
```

## Limits

- Guard rails, not a sandbox: a shell command or the contract code can change any file, including `.necro/`. The guarantee is `necro verify`, which trusts `.necro/lock.json`; commit it and check `git diff` before you trust a receipt. CONFIRMED means the same files give the same results, so a receipt that records failing contracts can be CONFIRMED too; in CI, run `necro audit`, which fails unless every ticked task's contracts pass.
- Receipts are files in the project, so an agent able to write files can add one. A forged receipt can only make `necro audit` accept a task whose required contracts pass now: it can fake where a tick came from, not whether the work holds.
- Each tick runs every frozen contract of the spec, one file after another, inside the hooks' 300 second limit. On the Node.js examples (13 and 18 contracts) that run takes about a second on a laptop; on this repository's own specs (117 and 209 contracts) a tick takes four to five minutes. In kiro-cli a hook that runs past its limit is stopped and the edit goes through, so such a tick lands with no receipt, and the Stop hook puts the task back to `[ ]` when the turn ends.
- A task line names each criterion it needs, one by one: the gate reads `(Req 1.2 to 1.4)` as 1.2 and 1.4 only.
- `--frozen-intrinsics` freezes the language's built-in prototypes (`String`, `Array`, `Object`, `Map` and the rest), not `JSON`, `Buffer`, the global names or Node's modules, and `plain()` cannot help against code that changes what a test framework does. Contracts that check `console` output get a writable copy of `console`.
- The receipt card on the viewer page checks hashes, not test runs. The play runs the example's seven JavaScript-only contracts in the browser, with small stand-ins for `node:test` and `node:assert`. The gate and `necro verify` run every contract in Node.js.
- Python contracts import the code from whatever environment runs them. Install the project itself there
  (`pip install -e .`), or the contracts can test another copy of the code than the files the receipt pins.
- The experiment is small: 3 to 5 runs per cell, two small models, one project, one planted contradiction.

### What runner contracts cannot defend against

Code under test runs inside the test framework's own process. It can tamper with that process: write the report from an exit handler, exit early with status 0, or patch the framework. The gate also trusts the language environment as much as the test framework does: the installed packages and the interpreter. Verify on a machine you control.

All limits: [docs/limits.md](docs/limits.md).

## License

MIT
