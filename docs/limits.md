# Limits

The full, honest limits of Contract Necromancer. The [README](../README.md) has the short version.

## Guard rails, not a sandbox

A shell command or the contract code itself can change any file on disk, including `.necro/`. The hooks are guard
rails: they stop the agent's ordinary edits and undo a task tick that the contracts do not support, but they cannot stop
a determined process that runs with your permissions. The hooks keep their own records (the task state and the copy of the
lock they restore) under `.necro/state/`, and a command that rewrites those too gets past them.

The guarantee is `necro verify`. It re-runs the frozen contracts from the lock and compares hashes and results with the
receipt, so a false "done" shows up as `MISMATCH`. `verify` trusts the lock file on disk, and `necro freeze` rewrites it,
so freezing is a person's job: commit `.necro/lock.json` with the contracts, and before you trust a receipt, check that
`git diff` shows no change to the lock or the contracts. Run `necro verify` in CI.

## Receipts are files

Receipts are files in the project, so an agent able to write files can add one. A forged receipt can only make
`necro audit` accept a task whose required contracts pass now: it can fake where a tick came from, not whether the work
holds.

## Ticks the gate cannot see

The gate sees a tick only when it goes through a tool call the hooks can read. Kiro's "Run all tasks" and its
sub-agents can mark a task done after a failed or killed run (see
[kirodotdev/Kiro#11786](https://github.com/kirodotdev/Kiro/issues/11786)), and an edit made outside Kiro never reaches the
hooks. `necro audit` checks every ticked task after the fact, so run it in CI. It needs the tools the contracts need: for
Python contracts, Python 3.11 or newer and pytest. Without them the task is reported as `cannot run`, which says nothing
about the work, and `audit` exits non-zero. See [the audit](reference.md#catch-a-tick-however-it-got-there).

## What runner contracts cannot defend against

Code under test runs inside the test framework's own process. It can tamper with that process: write the report from an
exit handler, exit early with status 0, or patch the framework. The exit status, the time limit and the locked files make
that harder, not impossible. The gate also trusts the language environment as much as the test framework does: the
installed packages and the interpreter. An agent that can install a package that the framework loads on its own, or
replace the interpreter, can make a failing run look like a pass. Run `necro verify` on a machine you control, from a
clean checkout and a clean environment, before you trust a receipt for code in another language.

## Contracts run with frozen intrinsics

A JavaScript contract file runs in a Node.js process started with `--frozen-intrinsics`, so code under test cannot patch
`String.prototype.split` or `Array.prototype.map` to change what a contract's assertions see; the patch throws and the
contract fails. This freezes the language's built-in prototypes (`String`, `Array`, `Object`, `Map`, `Set` and the rest).
It does not freeze `JSON`, `Buffer`, the global names or Node's own modules, so code that changes those can still change
what a contract sees. A result can also be an object with its own methods, such as a subclass of `String` with a `split`
that hides a line: compare `plain(result)` from `src/plain.js` instead. The flag also freezes `console`, and some contracts
assign to `console.log` to capture output, so the contract's process gets a writable copy of `console` and nothing else.

## Runtime postconditions

A check runs on every call of a guarded function, in production and not only in tests, so keep checks cheap. A check runs
after the function returns: it can stop a wrong result from being used but cannot undo what the function already did. It
does not catch a wrong or missing criterion, or calls inside a module to its own functions, which skip the wrapper.

Runtime postconditions protect only the outputs they check. A function with no postcondition can return a wrong result
and nothing stops it, so guard every function whose result reaches a user: the numbers, the text and the files, and not
only the arithmetic behind them. The demo's step 6 shows one cheat among many. An independent review beat the first
version of the ledger's guard twice: one cheat swapped two people's shares in `src/balances.js` (the balances still summed
to zero), and one halved every printed payment in `src/report.js` (nothing checked the report). The ledger now checks each
person's paid amount and share, and guards the text and JSON reports. A cheat in anything else it prints, such as the
error sentences, is still not caught. See [Runtime postconditions](reference.md#runtime-postconditions).

## The receipt viewer

The receipt card checks hashes, not test runs. The play runs the example's seven JavaScript-only contracts in the browser,
with small stand-ins for `node:test` and `node:assert`. The gate and `necro verify` run every contract in Node.js. MATCH means the receipt was not edited. It does not mean the contracts pass today.
Verifying a receipt runs the project's own contracts, which is code from that repository: run it only for a repository you
are willing to run. A file kept in Git LFS comes back as a pointer file and shows as different. Layout at phone width and
the clipboard cannot be tested in Node; they are checked by hand.

## The experiment

3 to 5 runs per cell, two small models, one small project, one planted contradiction. It shows a large, consistent effect
on this setup, not a general rate for every project or model. The gate-on condition includes the steering file, so it
measures the tool as installed, not the hook alone (the hook-only arm covers that). The impossible spec is synthetic.
One gated run took 986 s, and we did not break down where that time went. Details: [experiments/README.md](../experiments/README.md).

## Authorship

The tool did not gate its own first tasks: the early tasks of `necro-core` were built before that spec was frozen and have
no receipts. When a requirement changed late, a person made small edits to five frozen contract files and removed two
contract files that Kiro had replaced, each in a commit that says so. See [how it was built](how-it-was-built.md).
