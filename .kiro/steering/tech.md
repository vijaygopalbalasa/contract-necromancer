# Tech

- Node.js 24 or newer, ES modules, no runtime dependencies. Only Node built-ins (node:fs, node:path, node:crypto,
  node:child_process, node:test, node:assert).
- Tests use `node --test`. Every module has unit tests in `test/`.
- Hashes are SHA-256, lowercase hex.
- Canonical JSON: object keys sorted recursively, no whitespace, UTF-8.
- Paths stored in receipts and lock files are relative to the project root and use forward slashes.
- Errors shown to users are short plain sentences that say what to do next.
