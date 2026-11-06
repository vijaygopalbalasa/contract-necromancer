# Requirements: planner

## Introduction
Night Shift converts one party start time into every guest's local time, honestly, including around daylight saving changes.

## Requirement 1: Read the host's start time
**User story:** As a host, I want to give a start time in my own city, so that I do not do time zone math.
### Acceptance criteria
1. WHEN the host gives a date `YYYY-MM-DD`, a time `HH:MM` (24-hour) and an IANA time zone THE SYSTEM SHALL return the single UTC instant for that local time.
2. IF that local time does not exist in that zone because clocks jump forward THEN THE SYSTEM SHALL refuse it with one plain sentence naming the skipped hour.
3. IF that local time happens twice in that zone because clocks fall back THEN THE SYSTEM SHALL require the host to choose the earlier or the later one, and SHALL return the instant for the choice.
4. IF the date, the time or the zone name is not valid THEN THE SYSTEM SHALL refuse it with one plain sentence saying which one.

## Requirement 2: Every guest's local time
**User story:** As a guest, I want to see when the party starts where I live, so that I do not miss it.
### Acceptance criteria
1. WHEN guests are given as IANA time zones THE SYSTEM SHALL give each guest the local date, the local time `HH:MM` and the UTC offset at that instant (for example `+05:30`, `-04:00`, `+05:45`).
2. WHEN a guest's local date differs from the host's THE SYSTEM SHALL say whether it is the day before or the day after.
3. WHEN the list of guests is shown THE SYSTEM SHALL order it by local time at the start instant, earliest first, ties by zone name.

## Requirement 3: The dead of night
**User story:** As a host, I want to see who would be up at a ghostly hour, so that I can pick a kinder time.
### Acceptance criteria
1. WHEN a guest's local start time is from 00:00 up to but not including 06:00 THE SYSTEM SHALL mark that guest as up in the dead of night.
2. WHEN the host asks for a kinder time THE SYSTEM SHALL return the start time on the same host date, on the hour, that marks the fewest guests as up in the dead of night, choosing the earliest such hour when several tie.

## Requirement 4: The page
**User story:** As a host, I want a page I can share, so that guests see their own time.
### Acceptance criteria
1. WHEN the page loads with `?date=YYYY-MM-DD&time=HH:MM&zone=<IANA>&guests=<IANA>,<IANA>,...` THE SYSTEM SHALL show the party start for every guest from that link, using the same `src/` functions as the tests.
2. WHEN a guest is up in the dead of night THE SYSTEM SHALL show that row with a ghost marker and the words "dead of night", so the meaning does not depend on the picture.
3. WHEN the page loads THE SYSTEM SHALL use a dark theme with WCAG AA contrast, no external assets, work at phone width without horizontal scrolling, and turn off any animation under `prefers-reduced-motion: reduce`.
