# Red proofs: the contracts against six versions of routing.py

Before freezing, I ran the five contracts against six versions of `Route.handle` in `starlette/routing.py`. Each version
was patched into the clone in place, because the environment's editable install points there, and the file was put back
with git after each run. The command is the one in `spec/runners.json`, run on the whole folder:
`python3 -P -m pytest contracts/allow-header -q --noconftest -p no:cacheprovider`.

| Version of `routing.py` | Change | Contracts that fail |
|---|---|---|
| Main `271c277` | none | R1.1 (both), R1.2 |
| The correct fix | `", ".join(sorted(self.methods))` | none: 5 of 5 pass |
| A fix on the bare path only | sorted only where the route answers without an application | R1.1 inside an application |
| Sorted, HEAD dropped | `sorted(m for m in self.methods if m != "HEAD")` | R1.1 (both), R1.3 |
| Body changed | the correct fix, and the body `Method not allowed` | R1.3 |
| GET refused | the correct fix, and a 405 for GET as well | R1.4 |

The second R1.1 contract, for a route inside a Starlette application, was added after my review. Without it, the fix on
the bare path only passed every contract.
