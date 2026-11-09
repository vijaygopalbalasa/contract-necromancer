import re
from datetime import date

from leapage.errors import AgeError
from leapage.years import days_in_month

# Not \d (it matches digits of other scripts) and fullmatch, not $ (it matches before a final newline).
_SHAPE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def parse_date(text):
    """Read exactly YYYY-MM-DD, naming a real day, and return it as a date."""
    if _SHAPE.fullmatch(text):
        year, month, day = int(text[0:4]), int(text[5:7]), int(text[8:10])
        if year >= 1 and 1 <= month <= 12 and 1 <= day <= days_in_month(year, month):
            return date(year, month, day)
    # ascii() keeps a newline or a non-ASCII character in the argument from breaking the one-line message.
    raise AgeError(f"{ascii(text)} is not a real day written as YYYY-MM-DD.")
