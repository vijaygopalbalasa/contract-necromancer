from datetime import date

import pytest

from leapage.age import age_on
from leapage.errors import AgeError


def test_age_changes_on_the_birthday():
    born = date(2000, 6, 15)
    assert age_on(born, date(2025, 6, 14)) == 24
    assert age_on(born, date(2025, 6, 15)) == 25
    assert age_on(born, date(2025, 6, 16)) == 25


def test_the_birth_date_itself_is_age_zero():
    assert age_on(date(2000, 6, 15), date(2000, 6, 15)) == 0


@pytest.mark.parametrize(
    "on, age",
    [
        (date(2001, 2, 28), 0),
        (date(2001, 3, 1), 1),
        (date(2004, 2, 28), 3),
        (date(2004, 2, 29), 4),
        (date(2025, 2, 28), 24),
        (date(2025, 3, 1), 25),
    ],
)
def test_a_leap_day_birthday_is_1_march_in_a_common_year(on, age):
    assert age_on(date(2000, 2, 29), on) == age


def test_the_common_century_year_1900_has_no_29_february():
    born = date(1896, 2, 29)
    assert age_on(born, date(1900, 2, 28)) == 3
    assert age_on(born, date(1900, 3, 1)) == 4
    assert age_on(date(1996, 2, 29), date(2000, 2, 28)) == 3
    assert age_on(date(1996, 2, 29), date(2000, 2, 29)) == 4


def test_a_day_before_the_birth_date_raises_a_plain_sentence():
    with pytest.raises(AgeError) as caught:
        age_on(date(2000, 6, 15), date(2000, 6, 14))
    message = str(caught.value)
    assert message.endswith(".") and "\n" not in message
