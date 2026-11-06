# Design: planner

Requirements: `requirements.md` (final, unchanged). Constraints come from `.kiro/steering/tech.md`: Node 24+, ES modules, no
dependencies, time zone math with `Intl` only, logic in `src/` as pure functions, tests in `test/` run by `node --test`,
`site/` is a static page with no build step and no external assets.

## Overview

Two layers.

1. `src/` holds every decision: parsing, resolving a local time to an instant, guest rows, dead-of-night marking, the kinder
   time search, and the page view model. None of it touches the DOM, `window` or Node-only APIs, so the same files run in
   `node --test` and in the browser.
2. `site/` only reads `location.search`, calls one `src/` function, and writes the result into the page with `textContent`.

```
location.search ──> src/page.js buildView() ──> view model ──> site/main.js render() ──> DOM
                        │
                        ├─ src/input.js     validate date, time, zone
                        ├─ src/resolve.js   local time + zone -> UTC ms (gap / ambiguous handling)
                        ├─ src/guests.js    rows: local date, time, offset, day label, dead-of-night flag, ordering
                        ├─ src/kinder.js    best on-the-hour start on the host date
                        └─ src/zones.js     Intl primitives: localParts, offsetAt, formatOffset, isValidZone
```

Dependency direction is one way: `page` -> `guests`, `kinder`, `resolve`, `input` -> `zones`.

## Conventions

- An instant is a number of UTC milliseconds. A local time is always `{ date, time, zone }` with `date` as `YYYY-MM-DD`,
  `time` as `HH:MM`, `zone` as an IANA name.
- Functions return plain results and never throw for bad user input. Failures are `{ ok: false, error: "<one sentence>" }`.
  Successes are `{ ok: true, ... }`. Programmer errors (wrong argument types) may throw.
- Every user-facing sentence is one short sentence that says what to fix. Values echoed from the link are cut to 40
  characters and are only ever written to the page with `textContent`, never `innerHTML`, because the link is untrusted.
- Zone names are kept exactly as given for display and for the tie-break sort. `Intl` may canonicalise an alias (for example
  `Asia/Kathmandu` reports `Asia/Katmandu`), so the canonical name is never shown.

## Modules

### `src/zones.js`

Only place that calls `Intl`.

- `isValidZone(name)`: true when `new Intl.DateTimeFormat("en-US", { timeZone: name })` does not throw **and** the name does
  not start with `+` or `-`. The second check is needed: Node 24 accepts offset strings such as `+05:30` as a time zone, but
  the requirements ask for IANA names.
- `localParts(ms, zone)`: `{ year, month, day, hour, minute }` from `formatToParts` with `hourCycle: "h23"` (avoids
  `24:00` at midnight).
- `offsetAt(ms, zone)`: offset in minutes east of UTC. Computed as `Date.UTC(localParts) - floorToMinute(ms)`, divided by
  60000. Verified on this Node: New York `-300` then `-240` at 2026-03-08T07:00Z, Lord Howe `+630` then `+660`, Kathmandu `+345`.
- `formatOffset(minutes)`: `+05:30`, `-04:00`, `+05:45`, `+00:00` for UTC.
- `formatDate(parts)`, `formatTime(parts)`: zero-padded `YYYY-MM-DD` and `HH:MM`.

### `src/input.js` (Req 1.4)

`parseStart({ date, time, zone })` -> `{ ok: true, value: { date, time, zone } }` or `{ ok: false, error }`.

Checks run in the order date, time, zone and the first failure is reported, so there is always exactly one sentence that
names one field.

- Date: matches `^\d{4}-\d{2}-\d{2}$` and is a real calendar day (2026-02-30 fails; checked by building a UTC `Date` and
  comparing back).
- Time: matches `^\d{2}:\d{2}$`, hour 00-23, minute 00-59.
- Zone: `isValidZone`.
- A missing or empty value counts as invalid for its field.

Sentences:

- `The date "<value>" is not a real date; use YYYY-MM-DD.`
- `The time "<value>" is not valid; use HH:MM in 24-hour time.`
- `The time zone "<value>" is not a known IANA name; use a name like America/New_York.`
- Missing value: `The date is missing; use YYYY-MM-DD.` and the same shape for time and zone.

### `src/resolve.js` (Req 1.1, 1.2, 1.3)

`resolveLocal({ date, time, zone }, choice?)` where `choice` is `"earlier"` or `"later"`. Input is assumed already valid
(callers use `parseStart` first).

Algorithm:

1. `wall = Date.UTC(y, m - 1, d, hh, mm)`: the wall clock read as if it were UTC.
2. Take the offsets in force one day before and one day after `wall` (`offsetAt(wall - 864e5, zone)`,
   `offsetAt(wall + 864e5, zone)`). One day is wider than any real transition window and narrow enough that two transitions
   do not both fall inside it.
3. For each distinct offset `o`, the candidate instant is `wall - o * 60000`. Keep a candidate only if
   `localParts(candidate, zone)` formats back to the requested date and time. This drops candidates produced by the wrong
   offset.
4. Outcomes:
   - One candidate: `{ ok: true, ms }`.
   - Two candidates (clocks fell back): without `choice`, `{ ok: false, reason: "ambiguous", error, options: { earlier, later } }`.
     With `choice`, `{ ok: true, ms }` for the smaller or larger candidate.
   - Zero candidates (clocks jumped forward): `{ ok: false, reason: "gap", error }`.

Sentences:

- Gap: `02:30 does not exist in America/New_York on 2026-03-08 because clocks skip from 02:00 to 03:00; pick another time.`
- Ambiguous: `01:30 happens twice in America/New_York on 2026-11-01; choose the earlier or the later one.`

The skipped range in the gap sentence comes from `findTransition`: a binary search to the minute between `wall - 1 day`
and `wall + 1 day` for the instant where `offsetAt` changes. The skipped local range is `[t + offsetBefore, t + offsetAfter)`
formatted as `HH:MM`. The sentence says "from X to Y" instead of "the 02:00 hour" because gaps are not always an hour
(Australia/Lord_Howe skips 02:00 to 02:30 on 2026-10-04).

Cases the tests pin down (2026): New York gap 2026-03-08 02:30 and fold 2026-11-01 01:30; London gap 2026-03-29 01:30 and
fold 2026-10-25 01:30; Lord Howe half-hour gap 2026-10-04 02:15; Kolkata and UTC with no transitions; Halloween itself
(2026-10-31) in New York, London and Sydney as ordinary times.

### `src/night.js` (Req 3.1)

`isDeadOfNight({ hour })`: `hour >= 0 && hour < 6`. It works on the guest's local hour, so 05:59 is in and 06:00 is out.

### `src/guests.js` (Req 2.1, 2.2, 2.3, 3.1)

`planGuests(startMs, hostZone, guestZones)` -> `{ ok: true, rows }` or `{ ok: false, error }`.

- Every guest zone is checked with `isValidZone` first. The first bad one fails the whole call with
  `The guest time zone "<value>" is not a known IANA name; use a name like Asia/Kolkata.` The requirements do not say what
  to do with a bad guest zone; refusing is the honest option because dropping a guest silently would hide someone from the
  plan.
- Row shape: `{ zone, date, time, offset, dayOffset, dayLabel, deadOfNight }`.
  - `date`, `time`, `offset` from `localParts` and `offsetAt` at `startMs`.
  - `dayOffset` = whole-day difference between the guest's local date and the host's local date at the same instant,
    computed from `Date.UTC(y, m - 1, d)` values.
  - `dayLabel`: `""` for 0, `"the day before"` for -1, `"the day after"` for +1.
    The offset span in use today is -12:00 to +14:00, so two days apart is possible (host in Pacific/Kiritimati early in
    the morning, guest in Etc/GMT+12). Those rows read `"2 days before"` / `"2 days after"` so the label is never wrong.
  - `deadOfNight` from `isDeadOfNight` on the local hour.
- Order (Req 2.3): ascending by the guest's local date and time at `startMs` (so a guest on the day before sorts ahead of
  one on the same day), ties by zone name using plain string comparison. "Local time" is read as date plus time, not time of
  day alone, because time of day alone would put a 23:30 guest from yesterday after a 00:30 guest from tomorrow.
- Duplicate zones are kept as given. The host is not added to the rows; the host's own start line is shown separately by
  the page.

### `src/kinder.js` (Req 3.2)

`suggestKinderTime({ date, zone }, guestZones)` -> `{ date, time, ms, choice?, count }` or `null`.

- For each hour `h` in 0..23 on the host date, resolve `h:00` in the host zone with `resolveLocal`.
  - Normal hour: one candidate.
  - Skipped hour (gap): no candidate, hour is not offered. The host cannot start at a time that does not exist.
  - Repeated hour (fold): two candidates, the earlier and the later, with `choice` set so the result can be
    passed back to `resolveLocal`.
- For each candidate, `count` is the number of guests with `deadOfNight` at that instant (via `planGuests`).
- Pick the lowest `count`. Ties go to the earliest hour, and within a repeated hour to the earlier instant.
- Returns `null` only if no hour resolved, which cannot happen for real zones; it keeps the function total.
- Guest zones are assumed valid. The caller validates first.

### `src/page.js` (Req 4.1, 4.2, and the error paths of Req 1)

`buildView(search)` takes a `location.search` string and returns a view model. It is the only thing `site/main.js` calls.

Query: `date`, `time`, `zone`, `guests` (comma separated, empty items dropped, whitespace trimmed), plus one optional
parameter `pick` with value `earlier` or `later`.

`pick` is an addition to the link format in Req 4.1. Req 1.3 requires the host to choose between two instants, and the
page has no other place to keep that choice. A link without `pick` behaves exactly as Req 4.1 describes.

Flow: `parseStart` -> `resolveLocal(start, pick)` -> `planGuests` -> optional `suggestKinderTime`.

View model, one of:

- `{ status: "error", message }` for any validation failure, a gap, or a bad guest zone.
- `{ status: "choose", message, links: [{ label: "Use the earlier one", search }, { label: "Use the later one", search }] }`
  when the time happens twice. Each `search` is the current query with `pick` set.
- `{ status: "ok", host: { date, time, offset, zone }, rows, kinder }` where each row is the `planGuests` row plus
  `marker` (`"👻"` or `""`) and `note` (`"dead of night"` or `""`).
  `kinder` is `null` unless at least one row is `deadOfNight` and a different hour has a lower count; then it is
  `{ time, search, count }`, where `search` is the current query with `time` replaced (and `pick` set if the chosen hour is
  repeated). The page shows it as a plain link, so "asking for a kinder time" is a click that reloads the page with the new
  time.
- With no guests, `rows` is `[]` and the page shows the host line plus "No guests yet."

Row text for the marker and the words "dead of night" both come from the view model, so a test can check that the words are
present whenever the marker is (Req 4.2).

## Site (`site/`)

- `index.html`: semantic structure (`main`, a heading, a host line, a `table` or list for rows, a `p` for messages),
  `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<link rel="stylesheet" href="style.css">`,
  `<script type="module" src="main.js">`. No external URLs.
- `main.js`: `import { buildView } from "../src/page.js"`, builds nodes with `createElement` and `textContent`, and replaces
  the content of `main`. No logic beyond mapping view model fields to elements.
- `style.css`:
  - Colour custom properties in `:root` (`--bg`, `--fg`, `--muted`, `--accent`, `--night-bg`, `--night-fg`) so a test can
    read them.
  - Dark background, light text. Targets: body text at least 4.5:1, and the same for muted text, links and the dead-of-night
    row.
  - Rows separate state by text and marker, not by colour alone.
  - Layout uses a single column, `max-width` with padding, `overflow-wrap: anywhere` on zone names, and a table that
    becomes stacked blocks under 40rem, so nothing scrolls sideways at 320px.
  - Any `animation` or `transition` is declared only inside `@media (prefers-reduced-motion: no-preference)`, and a
    `@media (prefers-reduced-motion: reduce)` block sets `animation: none; transition: none` as a second guard.
  - No `@import`, no `url(...)`, no web fonts. System font stack only.
- The modules are loaded with a relative path `../src/`, and browsers block module imports from `file://`. To view the page,
  serve the repository root with any static server (for example `python3 -m http.server` from the project folder) and open
  `/site/?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata`.

### `src/contrast.js` (support for Req 4.3)

`contrastRatio(hexA, hexB)` implements the WCAG 2.x relative luminance formula for 6-digit hex colours. It exists so a unit
test can check the colours in `style.css` without a browser.

## Testing

Run with `npm test` (`node --test test/*.test.js`). Tests are written before the code they cover.

| File | Covers |
| --- | --- |
| `test/zones.test.js` | offsets and local parts across DST changes, `formatOffset`, offset-string rejection |
| `test/input.test.js` | Req 1.4 |
| `test/resolve.test.js` | Req 1.1, 1.2, 1.3 |
| `test/guests.test.js` | Req 2.1, 2.2, 2.3, 3.1 |
| `test/kinder.test.js` | Req 3.2 |
| `test/page.test.js` | Req 4.1, 4.2 (view model), pass-through of Req 1 errors |
| `test/site.test.js` | Req 4.3 static checks: contrast ratios from `style.css`, dark background, reduced-motion rule, no external URLs, viewport meta |

Not testable without a browser, so checked by hand once at the end: no horizontal scroll at 320px width, and the dark-theme
look. This is stated in the last task so it is not reported as verified by tests.

## Decisions to confirm

1. `pick=earlier|later` is added to the link so the choice in Req 1.3 survives a reload.
2. A bad guest zone refuses the whole plan with a sentence naming it, rather than skipping that guest.
3. The host is not listed among the guests unless the host's zone is also in `guests`. Dead-of-night counts and the kinder
   time use only the guests listed.
4. Rows sort by local date and time together, not by time of day alone.
5. The kinder time is offered as a link on the page when it improves on the current start, instead of a button with script
   state.
6. Day labels extend to "2 days before/after" for the rare case where the real difference is two days.
