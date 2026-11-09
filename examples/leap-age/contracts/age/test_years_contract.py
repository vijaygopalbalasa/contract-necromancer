"""Contracts for Requirement 1 (leap years) of the age spec: one test per criterion.

Each test is registered under the name of its criterion, for example "R1.1 ...", so the pytest report names the
testcase that way and the gate can match a task's criteria to it. The expected values are written here, from the
requirement, and checked against the standard library's own leap year rule where a table would be too small.
"""
import calendar
import sys
from pathlib import Path

import pytest

# `python3 -P` keeps the project folder off the import path, so the contract adds it itself.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from leapage.errors import AgeError  # noqa: E402
from leapage.years import days_in_month, is_leap_year  # noqa: E402


def contract(name):
    """Register the decorated function in this module under `name` (a Python function name cannot hold a dot)."""

    def register(function):
        globals()[name] = function

    return register


def one_plain_sentence(message):
    return message.strip() == message and message.endswith(".") and "\n" not in message


@contract("R1.1 a year is a leap year if divisible by 4, except century years not divisible by 400")
def leap_year_rule():
    leap = [4, 8, 1600, 1996, 2000, 2004, 2024, 2400, 9996]
    common = [1, 2, 3, 100, 1500, 1700, 1800, 1900, 2023, 2025, 2100, 2200, 2300, 9999]
    for year in leap:
        assert is_leap_year(year) is True, f"{year} is a leap year"
    for year in common:
        assert is_leap_year(year) is False, f"{year} is not a leap year"
    for year in range(1, 10000):
        assert is_leap_year(year) is calendar.isleap(year), f"{year} is {'' if calendar.isleap(year) else 'not '}a leap year"


@contract("R1.2 months have 31, 30 or 28 days, and February has 29 in a leap year")
def month_lengths():
    common = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    leap = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    for year in [1, 1900, 2023, 2025, 2100]:
        assert [days_in_month(year, m) for m in range(1, 13)] == common, f"months of {year}"
    for year in [4, 1600, 1996, 2000, 2024, 2400]:
        assert [days_in_month(year, m) for m in range(1, 13)] == leap, f"months of {year}"
    assert type(days_in_month(2024, 2)) is int


@contract("R1.3 a month that is not a whole number from 1 to 12 raises AgeError with one plain sentence")
def bad_month():
    for month in [0, 13, -1, 100, "2", 2.5, None]:
        with pytest.raises(AgeError) as caught:
            days_in_month(2024, month)
        assert one_plain_sentence(str(caught.value)), f"message for {month!r}: {str(caught.value)!r}"
    assert days_in_month(2024, 1) == 31 and days_in_month(2024, 12) == 31
