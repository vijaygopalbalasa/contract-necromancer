# Design: age

## Overview
Leap Age is a few small pure functions and a thin command line. `leapage/cli.py` reads the arguments, calls the functions and prints. Nothing else touches the console.

```
argv --parse_date--> two dates --age_on--> whole years --> printed line
          \                \
           days_in_month    is_leap_year
```

Constraints from steering: Python 3.11 or newer, the standard library only (pytest is needed to run the tests, nothing else), user-facing errors are one short plain sentence.

## Files

| File | Responsibility |
|---|---|
| `leapage/errors.py` | `AgeError`, the only error type shown to users. |
| `leapage/years.py` | `is_leap_year(year)` and `days_in_month(year, month)`. |
| `leapage/age.py` | `age_on(born, on)`, the age in whole years. |
| `leapage/dates.py` | `parse_date(text)`, a strict `YYYY-MM-DD` reader. |
| `leapage/cli.py` | `main(argv=None)` returns the exit code. |
| `leapage/__main__.py` | Calls `main` for `python3 -m leapage`. |
| `tests/test_*.py` | One test file per module, plus the command line through `subprocess`. |
| `contracts/age/test_*_contract.py` | The contracts, one test per criterion. Not unit tests: they are the frozen definition of done. |

## Components

### Errors (`leapage/errors.py`)
`AgeError(Exception)`. The message is the sentence shown to the user. The command line catches only this type. Anything else is a bug and surfaces as a traceback.

### Years (`leapage/years.py`)
- `is_leap_year(year)` returns `True` or `False` by the rule in Req 1.1. Do not use the year's last digits or a lookup of "every fourth year".
- `days_in_month(year, month)` returns an `int` (Req 1.2). If `month` is not an `int` from 1 to 12 it raises `AgeError("Month must be a whole number from 1 to 12.")` (Req 1.3). The text `"2"`, the number `2.5` and `True` are refused as well.

### Age (`leapage/age.py`)
`age_on(born, on)` takes two `datetime.date` values.

1. If `on < born`, raise `AgeError("That day is before the birth date. Give a day on or after it.")` (Req 2.3).
2. The birthday of `born` in a year is its month and day in that year. For a person born on 29 February, the birthday in a year that is not a leap year is 1 March (Req 2.2). That uses `is_leap_year`.
3. The age is `on.year - born.year`, minus one if `on` is before the birthday in `on.year` (Req 2.1). On the birthday itself the year has been counted.

Assumption: the law differs by country on whether a leap-day birthday falls on 28 February or 1 March in a common year. Req 2.2 fixes 1 March, and the design follows it.

### Dates (`leapage/dates.py`)
`parse_date(text)` returns a `datetime.date`.

1. Accept only `[0-9]{4}-[0-9]{2}-[0-9]{2}` matched against the whole text (`re.fullmatch`, ASCII digits written as a class, because `\d` also matches digits of other scripts and `$` also matches before a final newline). `datetime.date.fromisoformat` is not used, because Python 3.11 and newer also accept forms such as `20250209`.
2. Reject year 0, a month outside 1 to 12, and a day outside 1 to `days_in_month(year, month)`. Check the month first, so `days_in_month` is only called with a real month.
3. A refusal raises `AgeError` with `"<text> is not a real day written as YYYY-MM-DD."`, where `<text>` is `ascii(text)`. That keeps a newline or a non-ASCII character in the argument from spreading the message over two lines or failing to print.

### Command line (`leapage/cli.py`)
1. Exactly two arguments, else `AgeError("Give the birth date and the day to measure on as YYYY-MM-DD, for example 2000-02-29 2025-02-28.")`.
2. `parse_date` both, then `age_on`. Print the result and return 0 (Req 3.1).
3. On `AgeError` print the message to the error output, print nothing to the standard output, and return 1 (Req 3.2).

## Error messages
Each is one sentence on one line.

| Cause | Message |
|---|---|
| Month out of range or not whole | `Month must be a whole number from 1 to 12.` |
| Day before the birth date | `That day is before the birth date. Give a day on or after it.` |
| Bad date | `'2025-02-29' is not a real day written as YYYY-MM-DD.` |
| Wrong number of arguments | `Give the birth date and the day to measure on as YYYY-MM-DD, for example 2000-02-29 2025-02-28.` |

## Testing strategy
Unit tests use pytest, one file per module, with table-driven cases. `test_cli.py` runs `python3 -m leapage` with `subprocess` and checks the output, the error output and the exit code.

## Contracts
The contracts are pytest files under `contracts/age/`, one file per requirement. A runner command that exits with a non-zero status fails every contract in its file, so one file per requirement means a bug in one task's code fails only that task's contracts. Each criterion has exactly one test function. The reported testcase name must start with the criterion ID (`R1.1 ...`), because that is how the gate matches a task's criteria to contracts, and a Python function name cannot hold a dot. So each contract file registers its function in the module under the name `R1.1 ...` with a small decorator, and `pytest.ini` has `python_functions = test_* R[0-9]*.[0-9]*` so pytest collects those names.

`.kiro/specs/age/runners.json` runs them without a shell:

- The command is `python3 -P -m pytest {file} --junitxml={report} -q --noconftest -p no:cacheprovider`. `-P` keeps the project folder off the import path, so a file named `pytest.py` cannot stand in for pytest (the contracts add the project folder to the path themselves). `--noconftest` ignores every `conftest.py`. `-p no:cacheprovider` writes no cache folder.
- `"sources"` is `leapage/*.py`, the code the contracts exercise. A receipt pins those files, and `necro verify` prints `MISMATCH` when one changes.
- `"frozen"` is `**/pytest.ini` and `**/pyproject.toml`, which decide how pytest is configured. They are locked with the spec, and a new one added after the freeze (for example in `contracts/age/`, which pytest would read first) makes every contract fail.

Limit, as for every runner contract: the code under test runs inside pytest's process, and the gate trusts the installed packages and the Python interpreter. A `tox.ini` or `setup.cfg` added later can also configure pytest, and cannot be listed under `"frozen"` while no such file exists.

## Requirement coverage

| Req | Where |
|---|---|
| 1.1 | `years.py` (`is_leap_year`) |
| 1.2, 1.3 | `years.py` (`days_in_month`) |
| 2.1, 2.2, 2.3 | `age.py` |
| 3.1 | `cli.py`, `dates.py`, `age.py` |
| 3.2 | `cli.py`, `dates.py`, `age.py` |
