# Tasks: planner

Each task writes its tests first, sees them fail, then writes the code until they pass. Run `npm test` after every task.
Page logic stays in `src/`; `site/` only renders the view model.

- [x] 1. Zone primitives
  - Write `test/zones.test.js`: `offsetAt` for New York across 2026-03-08 and 2026-11-01, Lord Howe `+630`/`+660`,
    Asia/Kathmandu `+345`, Asia/Kolkata `+330`; `localParts` at midnight returns hour 0, not 24; `formatOffset` gives
    `+05:30`, `-04:00`, `+05:45`, `+00:00`; `isValidZone` accepts `America/New_York` and `UTC`, rejects `Nope/Zone`, an
    empty string, and `+05:30`.
  - Implement `src/zones.js`: `isValidZone`, `localParts`, `offsetAt`, `formatOffset`, `formatDate`, `formatTime`.
  - (Req 1.4, 2.1)

- [x] 2. Input validation
  - Write `test/input.test.js`: valid input passes; `2026-02-30`, `2026-13-01`, `10/31/2026` fail with a sentence naming
    the date; `24:00`, `7:5`, `12:60` fail naming the time; `Mars/Base` and a missing zone fail naming the zone; when
    date and zone are both bad only the date is reported; every error is a single sentence (one trailing period, no
    newline); long values are cut to 40 characters.
  - Implement `src/input.js` with `parseStart`.
  - (Req 1.4)

- [x] 3. Local time to UTC instant
  - Write `test/resolve.test.js`: ordinary times return the exact UTC ms (Halloween 2026 20:00 in New York, London, Sydney,
    Kolkata, UTC); New York 2026-03-08 02:30 and London 2026-03-29 01:30 return `reason: "gap"` with a sentence naming the
    skipped range; Lord Howe 2026-10-04 02:15 names `02:00 to 02:30`; New York 2026-11-01 01:30 and London 2026-10-25
    01:30 return `reason: "ambiguous"` without a choice, and with `earlier` / `later` return instants exactly one hour
    apart; times just before and after each change resolve normally.
  - Implement `src/resolve.js`: `resolveLocal` and the transition search used for the gap sentence.
  - (Req 1.1, 1.2, 1.3)

- [x] 4. Guest rows, day labels, ordering and dead-of-night marking
  - Write `test/guests.test.js`: for a 2026-10-31 20:00 New York start, each guest has the right local date, `HH:MM` and
    offset (London `+00:00`, Kolkata `+05:30`, Kathmandu `+05:45`, Caracas, Sydney); day label is empty, "the day before",
    or "the day after" as appropriate, and "2 days before" for a Kiritimati host with an Etc/GMT+12 guest; rows are
    sorted by local date and time with ties broken by zone name; 00:00, 05:59 are `deadOfNight`, 06:00 and 23:59 are not;
    a bad guest zone gives one sentence naming it.
  - Implement `src/night.js` (`isDeadOfNight`) and `src/guests.js` (`planGuests`).
  - (Req 2.1, 2.2, 2.3, 3.1)

- [x] 5. Kinder time
  - Write `test/kinder.test.js`: returns the fewest-count hour on the host date; ties choose the earliest hour; an hour
    skipped by a gap is never returned (New York 2026-03-08 never offers 02:00); a repeated hour (New York 2026-11-01
    01:00) can be returned with `choice: "earlier"` when it wins; no guests returns hour `00:00` with count 0; the result
    stays on the host date.
  - Implement `src/kinder.js` with `suggestKinderTime`.
  - (Req 3.2)

- [x] 6. Page view model
  - Write `test/page.test.js`: the full example link
    `?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata` gives `status: "ok"` with one row
    per guest from the link in sorted order; a dead-of-night row has marker `👻` and the note `dead of night`, other rows
    have neither; an ambiguous time gives `status: "choose"` with two links and `pick=earlier` / `pick=later` gives `ok`;
    a gap, bad date, bad zone and bad guest zone each give `status: "error"` with the one-sentence message; empty
    `guests` gives empty rows; `kinder` is `null` when nobody is in the dead of night and a link with a new `time` when
    someone is; the function does not read any global.
  - Implement `src/page.js` with `buildView`, wiring `input`, `resolve`, `guests` and `kinder`.
  - (Req 4.1, 4.2; Req 1.2, 1.3, 1.4 as surfaced on the page)

- [x] 7. Contrast helper and stylesheet
  - Write `test/contrast.test.js` (`contrastRatio` of black on white is 21, white on white is 1, a known mid-grey pair) and
    `test/site.test.js` checks for `site/style.css`: colour custom properties parsed from `:root`; every text/background pair
    (`--fg`/`--bg`, `--muted`/`--bg`, `--accent`/`--bg`, `--night-fg`/`--night-bg`) is at least 4.5:1; `--bg` luminance is
    below 0.1; the file contains `prefers-reduced-motion: reduce`; any `animation` or `transition` appears only inside a
    `prefers-reduced-motion: no-preference` block; no `@import`, `url(`, or `http`.
  - Implement `src/contrast.js` and write `site/style.css`: dark theme, system fonts, single column, stacked rows under
    40rem, `overflow-wrap: anywhere` on zone names.
  - (Req 4.3)

- [x] 8. Page markup and rendering, then final check
  - Write the `site/index.html` checks in `test/site.test.js` first: contains the viewport meta tag, links `style.css`,
    loads `main.js` as a module, has no `http` or `//` external URL; `site/main.js` imports only `../src/page.js` and does
    not use `innerHTML`.
  - Write `site/index.html` and `site/main.js`: call `buildView(location.search)` and render `ok`, `choose` and `error`
    states with `createElement` and `textContent`; show the host line, rows with marker and the visible words
    "dead of night", the kinder-time link, and "No guests yet." when empty.
  - Run `npm test` and confirm everything passes. Then serve the folder (`python3 -m http.server`) and check by hand, once:
    the example link renders, a dead-of-night row shows the ghost and the words, nothing scrolls sideways at 320px width,
    and with reduced motion enabled in the browser nothing animates. Report these manual checks as manual, not as test
    results.
  - (Req 4.1, 4.2, 4.3)

- [x] 9. A form with a working example (Req 4.4)
  - Write tests first for the pure parts (reading form values into the link and back, the default example, a refusal message placed next to the form) and see them fail. Then update `site/` so the page with no query string shows the filled form and the example's result, and submitting it updates the link. Keep 4.1 to 4.3: no external assets, dark theme, AA contrast, no sideways scrolling at 320px, no animation under reduced motion.
  - Add `contracts/planner/form.contract.test.js` with one contract named `R4.4 ...` (a new file; do not change the frozen contract files). Run `npm test` and pass. Report any check you could only do by hand as manual.

