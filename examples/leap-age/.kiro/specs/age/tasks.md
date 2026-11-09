# Tasks: age

Each task writes its tests first, confirms they fail, then adds the code that makes them pass. Run tests with `python3 -m pytest tests -q -p no:cacheprovider`.

- [x] 1. Leap years and month lengths (Req 1.1, 1.2, 1.3)
  - Write `tests/test_years.py`: 1996, 2000, 2004 and 2400 are leap years; 1900, 2100, 2200 and 2023 are not; every month length in a leap year and in a common year; months 0, 13 and -1, the text `"2"`, the number 2.5 and `True` raise `AgeError` with a one-sentence message.
  - Add `leapage/errors.py` with `AgeError` and `leapage/years.py` with `is_leap_year` and `days_in_month`.

- [x] 2. Age in whole years (Req 2.1, 2.2, 2.3)
  - Write `tests/test_age.py`: the day before a birthday, the birthday and the day after give n-1, n and n; the birth date itself gives 0; a person born on 29 February 2000 is 0 on 28 February 2001 and 1 on 1 March 2001, 4 on 29 February 2004, and 24 on 28 February 2025 and 25 on 1 March 2025; the same holds across the common century year 1900; a day before the birth date raises `AgeError` with a one-sentence message.
  - Add `leapage/age.py` with `age_on(born, on)` for two `datetime.date` values.

- [x] 3. Strict dates and the command line (Req 3.1, 3.2)
  - Write `tests/test_dates.py`: `2025-02-28` is read; `2025-02-29`, `2025-2-9`, `20250209`, `2025-02-09 `, `2025-02-09` followed by a newline, full-width digits, `0000-01-01` and `2025-13-01` are refused with a one-sentence message that stays on one line.
  - Write `tests/test_cli.py` with `subprocess` on `python3 -m leapage`: the age is printed on its own line and the exit code is 0; each bad input exits 1, prints one line on the error output and nothing on the standard output.
  - Add `leapage/dates.py` with `parse_date`, `leapage/cli.py` with `main`, and `leapage/__main__.py`. Run the whole `tests/` folder.
