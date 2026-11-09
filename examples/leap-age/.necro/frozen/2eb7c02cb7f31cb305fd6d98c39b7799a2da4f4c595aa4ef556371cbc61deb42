"""Contracts for Requirement 2 (age in whole years) of the age spec: one test per criterion.

Each test is registered under the name of its criterion, for example "R2.1 ...", so the pytest report names the
testcase that way and the gate can match a task's criteria to it. The expected ages come from tables and from a small
oracle written here that counts birthdays one by one, without using the code under test.
"""
import calendar
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

# `python3 -P` keeps the project folder off the import path, so the contract adds it itself.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from leapage.age import age_on  # noqa: E402
from leapage.errors import AgeError  # noqa: E402


def contract(name):
    """Register the decorated function in this module under `name` (a Python function name cannot hold a dot)."""

    def register(function):
        globals()[name] = function

    return register


def one_plain_sentence(message):
    return message.strip() == message and message.endswith(".") and "\n" not in message


def days(first, last):
    day = first
    while day <= last:
        yield day
        day += timedelta(days=1)


def birthdays_had(born, on):
    """Count the birthdays after the birth date up to and including `on`, one year at a time."""
    count = 0
    for year in range(born.year + 1, on.year + 1):
        if (born.month, born.day) == (2, 29) and not calendar.isleap(year):
            birthday = date(year, 3, 1)
        else:
            birthday = date(year, born.month, born.day)
        if birthday <= on:
            count += 1
    return count


@contract("R2.1 the age counts the birthdays had up to and including the day, so it goes up on the birthday itself")
def whole_years():
    table = [
        (date(2000, 6, 15), date(2025, 6, 14), 24),
        (date(2000, 6, 15), date(2025, 6, 15), 25),
        (date(2000, 6, 15), date(2025, 6, 16), 25),
        (date(2000, 6, 15), date(2000, 6, 15), 0),
        (date(2000, 6, 15), date(2001, 6, 14), 0),
        (date(2000, 6, 15), date(2001, 6, 15), 1),
        (date(1999, 12, 31), date(2000, 1, 1), 0),
        (date(1999, 12, 31), date(2000, 12, 30), 0),
        (date(1999, 12, 31), date(2000, 12, 31), 1),
        (date(2001, 1, 1), date(2001, 12, 31), 0),
        (date(2001, 1, 1), date(2002, 1, 1), 1),
        (date(1950, 3, 1), date(2025, 2, 28), 74),
        (date(1950, 3, 1), date(2025, 3, 1), 75),
    ]
    for born, on, expected in table:
        assert age_on(born, on) == expected, f"born {born}, on {on}: expected {expected}, got {age_on(born, on)}"
    for born in [date(2000, 6, 15), date(1999, 12, 31), date(2001, 1, 1), date(2003, 3, 1)]:
        for on in days(born, born + timedelta(days=3 * 366)):
            assert age_on(born, on) == birthdays_had(born, on), f"born {born}, on {on}"


@contract("R2.2 a person born on 29 February has their birthday on 1 March in a year that is not a leap year")
def leap_day_birthday():
    table = [
        (date(2000, 2, 29), date(2000, 2, 29), 0),
        (date(2000, 2, 29), date(2001, 2, 28), 0),
        (date(2000, 2, 29), date(2001, 3, 1), 1),
        (date(2000, 2, 29), date(2003, 3, 1), 3),
        (date(2000, 2, 29), date(2004, 2, 28), 3),
        (date(2000, 2, 29), date(2004, 2, 29), 4),
        (date(2000, 2, 29), date(2024, 2, 29), 24),
        (date(2000, 2, 29), date(2025, 2, 28), 24),
        (date(2000, 2, 29), date(2025, 3, 1), 25),
        # 1900 and 2100 are not leap years, 2000 is: the century rule and the leap day together.
        (date(1896, 2, 29), date(1900, 2, 28), 3),
        (date(1896, 2, 29), date(1900, 3, 1), 4),
        (date(1996, 2, 29), date(2000, 2, 28), 3),
        (date(1996, 2, 29), date(2000, 2, 29), 4),
        (date(2096, 2, 29), date(2100, 2, 28), 3),
        (date(2096, 2, 29), date(2100, 3, 1), 4),
    ]
    for born, on, expected in table:
        assert age_on(born, on) == expected, f"born {born}, on {on}: expected {expected}, got {age_on(born, on)}"
    for born, last in [(date(1896, 2, 29), date(1905, 12, 31)), (date(1996, 2, 29), date(2005, 12, 31)), (date(2096, 2, 29), date(2105, 12, 31))]:
        for on in days(born, last):
            assert age_on(born, on) == birthdays_had(born, on), f"born {born}, on {on}"


@contract("R2.3 a day before the birth date raises AgeError with one plain sentence")
def day_before_birth():
    cases = [
        (date(2000, 6, 15), date(2000, 6, 14)),
        (date(2000, 1, 1), date(1999, 12, 31)),
        (date(2000, 6, 15), date(1990, 6, 15)),
        (date(2000, 2, 29), date(2000, 2, 28)),
    ]
    for born, on in cases:
        with pytest.raises(AgeError) as caught:
            age_on(born, on)
        assert one_plain_sentence(str(caught.value)), f"message for born {born}, on {on}: {str(caught.value)!r}"
    assert age_on(date(2000, 6, 15), date(2000, 6, 15)) == 0
