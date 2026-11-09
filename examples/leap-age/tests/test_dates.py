from datetime import date

import pytest

from leapage.dates import parse_date
from leapage.errors import AgeError


def test_a_real_day_is_read():
    assert parse_date("2025-02-28") == date(2025, 2, 28)
    assert parse_date("2024-02-29") == date(2024, 2, 29)


@pytest.mark.parametrize(
    "text",
    [
        "2025-02-29",
        "2025-2-9",
        "20250209",
        "2025-02-09 ",
        "2025-02-09\n",
        "\uff12\uff10\uff12\uff15-02-09",
        "0000-01-01",
        "2025-13-01",
        "2025-00-10",
        "2025-04-31",
        "2025-W06-1",
        "",
    ],
)
def test_a_bad_date_raises_a_one_line_sentence(text):
    with pytest.raises(AgeError) as caught:
        parse_date(text)
    message = str(caught.value)
    assert message.endswith(".") and "\n" not in message and message.isascii()
