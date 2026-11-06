# Contract Necromancer

Design by Contract for Kiro specs. Each EARS acceptance criterion in `.kiro/specs/<spec>/requirements.md` gets an
executable contract in `contracts/<spec>/`. A person freezes them, and Kiro hooks refuse to let a task in `tasks.md` be
marked done until the frozen contracts pass. Every task that passes gets a receipt that anyone can re-run.

```
necro init              # write the Kiro hooks and steering file into a project
necro freeze <spec>     # lock requirements.md and the contracts of a spec
necro verify <receipt>  # re-run a receipt and print CONFIRMED or MISMATCH
```

Requires Node.js 24 or newer. There are no runtime dependencies.

## Limits

A shell command or the contract code itself can change any file on disk, including `.necro/`. The hooks are guard
rails: they stop the agent's ordinary edits and undo a task tick that the contracts do not support, but they cannot stop
a determined process that runs with your permissions.

The guarantee is `necro verify`. It re-runs the frozen contracts from the lock and compares hashes and results with the
receipt, so a false "done" shows up as `MISMATCH` no matter what happened during the session. Run it in CI or before you
trust a receipt.
