# Structure

- `bin/necro.js`: CLI entry, parses arguments and calls into `src/`.
- `src/`: one module per concern (canonical JSON and hashing, lock file, contracts runner, receipts, hook handlers, verify).
- `test/`: unit tests, one file per module, plus fixtures in `test/fixtures/`.
- `templates/`: files that `necro init` writes into a user's project.
- `contracts/`, `.necro/`: this repository's own frozen contracts and lock (the tool is built under its own gate).
