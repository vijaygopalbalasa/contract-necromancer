# Tech
- Node.js 24 or newer, ES modules, no dependencies. Time zone math uses the built-in `Intl` API only.
- All logic lives in `src/` as pure functions with unit tests in `test/` run by `node --test`. `site/` is a static page
  (no build step, no external assets) that imports the same `src/` modules in the browser.
- Instants are handled as UTC milliseconds; a local time is always paired with an IANA time zone name.
- Errors shown to users are one short plain sentence that says what to fix.
