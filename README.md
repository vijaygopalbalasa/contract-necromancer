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

## Receipt viewer

`site/` is a static page that opens a receipt, lists each contract with PASS or FAIL, recomputes the receipt hash in the
browser, and shows the command to re-run the receipt. It has no server, no build step and no dependencies.

- Address once published: `https://OWNER.github.io/REPO/` (replace with your own; `.github/workflows/pages.yml` deploys
  `site/`). The repository owner sets Settings > Pages > Source to "GitHub Actions" once.
- Open a receipt directly with `?receipt=<raw url>`, where the URL is the Raw link of a receipt on
  raw.githubusercontent.com, for example `https://OWNER.github.io/REPO/?receipt=https://raw.githubusercontent.com/OWNER/REPO/main/.necro/receipts/SPEC/HASH.json`.
  Other hosts are refused. You can also paste the JSON or pick the file.
- Honest limit: contracts re-run in Node with `necro verify`. The browser checks hashes, not test runs. MATCH means the
  receipt was not edited. It does not mean the contracts pass today.
- Run it locally: browsers do not load ES modules from `file://`, so serve the folder, for example
  `python3 -m http.server -d site`, then open http://localhost:8000/.
- The file check fetches pinned files from raw.githubusercontent.com, which serves the stored blob. A file kept in Git
  LFS comes back as a pointer file and shows as different.

The page's tests run with `npm test`. Layout at phone width and the clipboard cannot be tested in Node; check them by
hand.
