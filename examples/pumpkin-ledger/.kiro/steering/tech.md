# Tech
- Node.js 24 or newer, ES modules, no dependencies. Only Node built-ins.
- Tests use `node --test` in `test/`. Logic lives in `src/` as pure functions; `bin/ledger.js` only parses arguments and prints.
- Money is integer cents everywhere. Never use floating point for amounts.
- Errors shown to users are one short plain sentence that says what to fix.
