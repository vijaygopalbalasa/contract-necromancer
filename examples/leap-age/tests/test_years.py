import pytest

from leapage.errors import AgeError
from leapage.years import days_in_month, is_leap_year


@pytest.mark.parametrize("year", [4, 1600, 1996, 2000, 2004, 2024, 2400])
def test_leap_years(year):
    assert is_leap_year(year) is True


@pytest.mark.parametrize("year", [1, 100, 1900, 2023, 2025, 2100, 2200, 2300])
def test_common_years(year):
    assert is_leap_year(year) is False


@pytest.mark.parametrize(
    "month, days",
    [(1, 31), (2, 28), (3, 31), (4, 30), (5, 31), (6, 30), (7, 31), (8, 31), (9, 30), (10, 31), (11, 30), (12, 31)],
)
def test_month_lengths_in_a_common_year(month, days):
    assert days_in_month(2023, month) == days


def test_february_has_29_days_in_a_leap_year_only():
    assert days_in_month(2024, 2) == 29
    assert days_in_month(2000, 2) == 29
    assert days_in_month(1900, 2) == 28


@pytest.mark.parametrize("month", [0, 13, -1, "2", 2.5, None, True])
def test_a_bad_month_raises_a_plain_sentence(month):
    with pytest.raises(AgeError) as caught:
        days_in_month(2024, month)
    message = str(caught.value)
    assert message.endswith(".") and "\n" not in message
