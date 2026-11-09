from datetime import date

from leapage.errors import AgeError
from leapage.years import is_leap_year


def _birthday_in(born, year):
    """The day in `year` on which a person born on `born` has a birthday.

    A person born on 29 February has it on 1 March in a year that is not a leap year.
    """
    if born.month == 2 and born.day == 29 and not is_leap_year(year):
        return date(year, 3, 1)
    return date(year, born.month, born.day)


def age_on(born, on):
    """The number of birthdays a person born on `born` has had up to and including `on`."""
    if on < born:
        raise AgeError("That day is before the birth date. Give a day on or after it.")
    years = on.year - born.year
    if on < _birthday_in(born, on.year):
        years -= 1
    return years
