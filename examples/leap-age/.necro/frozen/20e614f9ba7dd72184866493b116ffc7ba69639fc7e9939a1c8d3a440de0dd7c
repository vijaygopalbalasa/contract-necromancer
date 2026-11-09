# Requirements: age

## Introduction
Leap Age tells how old a person is on a given day, in whole years, and gets the leap day right.

## Requirement 1: Leap years
**User story:** As someone who works with dates, I want leap years decided by the real calendar rule, so that every February has the right number of days.
### Acceptance criteria
1. WHEN a year is asked about THE SYSTEM SHALL call it a leap year if it is divisible by 4, except that a year divisible by 100 is a leap year only if it is also divisible by 400 (so 1996 and 2000 are leap years, and 1900 and 2100 are not).
2. WHEN the number of days in a month of a year is asked for THE SYSTEM SHALL give 31 for January, March, May, July, August, October and December, 30 for April, June, September and November, and 29 for February in a leap year and 28 in any other year.
3. IF the month is not a whole number from 1 to 12 THEN THE SYSTEM SHALL raise an `AgeError` whose message is one plain sentence.

## Requirement 2: Age in whole years
**User story:** As a person with a birthday, I want my age counted in the birthdays I have had, so that it changes on the right day.
### Acceptance criteria
1. WHEN the age of a person born on a date is asked for on a given day THE SYSTEM SHALL give the number of birthdays the person has had up to and including that day, so the age goes up on the birthday itself, not the day before or after.
2. WHEN a person was born on 29 February THE SYSTEM SHALL treat 1 March as their birthday in every year that is not a leap year.
3. IF the given day is before the birth date THEN THE SYSTEM SHALL raise an `AgeError` whose message is one plain sentence.

## Requirement 3: Command line
**User story:** As a user, I want one command, so that I can find an age without writing code.
### Acceptance criteria
1. WHEN a user runs `python3 -m leapage <born> <on>` with two dates written as `YYYY-MM-DD` THE SYSTEM SHALL print the age on `<on>` of a person born on `<born>`, as a whole number on a line of its own, and exit with code 0.
2. IF an argument is not a real calendar day written exactly as `YYYY-MM-DD`, or the day `<on>` is before `<born>`, or the number of arguments is not two, THEN THE SYSTEM SHALL print one plain sentence on one line to the error output, print nothing to the standard output, and exit with code 1.
