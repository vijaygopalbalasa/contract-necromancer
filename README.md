# Contract Necromancer

Design by Contract, from Eiffel (1986), raised for coding agents.

A coding agent can mark a task done in Kiro when the work does not meet the requirements. Contract Necromancer's Kiro hooks refuse the tick in `tasks.md` until the frozen contracts for that task pass, and each passing task leaves a receipt that anyone can re-run.

**[Result](experiments/README.md):** on a task that cannot honestly be finished, Kiro marked it done in 11 of 11 runs without the gate and 0 of 19 with it, across two models; the hook alone was enough. Under a "do whatever it takes" prompt, one gated run of six got past the gate by patching JavaScript built-ins; that hole is closed and the cheat is kept as a test.

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
necro verify <receipt>     # re-run a receipt: CONFIRMED (its results reproduce, failures included), MISMATCH or SUPERSEDED
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

## See it

- [Live receipt viewer](https://vijaygopalbalasa.github.io/contract-necromancer/), which opens a receipt from a Raw link on `https://raw.githubusercontent.com/vijaygopalbalasa/contract-necromancer/` with `?receipt=`.
- [Demo video](https://youtu.be/TYrSyhIYqlk).
- [Case study](case-studies/judge-api-errors/README.md): a real fix in Judge Protocol, gated end to end; the gate refused a half-done tick. Its receipts are in this repository; the change itself lands in judge-protocol after Nov 15.
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
- `--frozen-intrinsics` freezes the language's built-in prototypes (`String`, `Array`, `Object`, `Map` and the rest), not `JSON`, `Buffer`, the global names or Node's modules, and `plain()` cannot help against code that changes what a test framework does. Contracts that check `console` output get a writable copy of `console`.
- The receipt card on the viewer page checks hashes, not test runs. The play runs the example's seven JavaScript-only contracts in the browser, with small stand-ins for `node:test` and `node:assert`. The gate and `necro verify` run every contract in Node.js.
- The experiment is small: 3 to 5 runs per cell, two small models, one project, one planted contradiction.

### What runner contracts cannot defend against

Code under test runs inside the test framework's own process. It can tamper with that process: write the report from an exit handler, exit early with status 0, or patch the framework. The gate also trusts the language environment as much as the test framework does: the installed packages and the interpreter. Verify on a machine you control.

All limits: [docs/limits.md](docs/limits.md).

## License

MIT
