from leapage.errors import AgeError

_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def is_leap_year(year):
    """Divisible by 4, except a year divisible by 100 must also be divisible by 400."""
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year, month):
    """The number of days in a month (1 to 12) of a year."""
    if not isinstance(month, int) or isinstance(month, bool) or not 1 <= month <= 12:
        raise AgeError("Month must be a whole number from 1 to 12.")
    if month == 2 and is_leap_year(year):
        return 29
    return _DAYS[month - 1]
