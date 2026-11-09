import sys

from leapage.age import age_on
from leapage.dates import parse_date
from leapage.errors import AgeError

USAGE = "Give the birth date and the day to measure on as YYYY-MM-DD, for example 2000-02-29 2025-02-28."


def main(argv=None):
    """Print the age for two dates and return the exit code."""
    args = sys.argv[1:] if argv is None else argv
    try:
        if len(args) != 2:
            raise AgeError(USAGE)
        age = age_on(parse_date(args[0]), parse_date(args[1]))
    except AgeError as error:
        print(error, file=sys.stderr)
        return 1
    print(age)
    return 0
