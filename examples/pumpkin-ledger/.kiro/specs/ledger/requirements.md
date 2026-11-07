# Requirements: ledger

## Introduction
Pumpkin Ledger reads a list of shared expenses and prints each person's balance and the payments that settle them.

## Requirement 1: Read expenses
**User story:** As a party host, I want to type expenses in plain lines, so that I do not need a spreadsheet.
### Acceptance criteria
1. WHEN a line reads `<payer> paid <amount> for <what>` THE SYSTEM SHALL record an expense of `<amount>` paid by `<payer>`, where `<amount>` is a number with at most two decimals (for example `12`, `12.5`, `12.50`), stored as integer cents.
2. WHEN a line ends with `split <name>,<name>,...` THE SYSTEM SHALL share that expense only among the listed names, and otherwise among everyone named anywhere in the file.
3. WHEN names differ only in letter case or surrounding spaces THE SYSTEM SHALL treat them as the same person, shown with the spelling of its first appearance.
4. IF a line cannot be read, or an amount is zero, negative or has more than two decimals THEN THE SYSTEM SHALL stop with the line number and one plain sentence saying what is wrong.
5. WHEN a line is empty or starts with `#` THE SYSTEM SHALL skip it.

## Requirement 2: Split to the cent
**User story:** As a guest, I want the split to add up exactly, so that nobody loses a cent.
### Acceptance criteria
1. WHEN an expense is shared by N people THE SYSTEM SHALL give each person `floor(amount / N)` cents and give the remaining cents one each to the sharers in alphabetical order of name (case-insensitive).
2. WHEN all expenses are split THE SYSTEM SHALL make each person's balance equal to what they paid minus their shares, and the balances SHALL sum to exactly zero.

## Requirement 3: Settle up
**User story:** As a guest, I want as few payments as possible, so that settling is quick.
### Acceptance criteria
1. WHEN balances are settled THE SYSTEM SHALL produce payments that bring every balance to zero, each payment a positive whole number of cents.
2. WHEN balances are settled THE SYSTEM SHALL repeatedly pay from the person who owes the most to the person who is owed the most (ties broken by name, case-insensitive), moving the smaller of the two amounts, so the result is the same on every run.
3. WHEN everyone's balance is already zero THE SYSTEM SHALL print `All square.` and no payments.

## Requirement 4: Command line
**User story:** As a party host, I want one command, so that I can paste the result in the group chat.
### Acceptance criteria
1. WHEN a user runs `ledger <file>` THE SYSTEM SHALL print a balances table (name, paid, share, balance) and then one line per payment as `<from> pays <to> <amount>`, with amounts written with two decimals.
2. WHEN a user runs `ledger <file> --json` THE SYSTEM SHALL print `{"balances":[...],"payments":[...]}` with amounts in integer cents.
3. IF the file is missing or unreadable THEN THE SYSTEM SHALL exit with code 1 and one plain sentence.

## Requirement 5: Properties that hold for every party
**User story:** As someone who splits real bills, I want the arithmetic to hold for any party, not only the examples, so that nobody ever loses a cent.
### Acceptance criteria
1. WHEN any valid list of expenses is split (generated from a fixed seed: 1 to 12 people, 1 to 30 expenses, amounts from 0.01 to 9,999.99, random `split` lists and name spellings) THE SYSTEM SHALL give each expense shares that sum to exactly its amount, with no two shares of one expense differing by more than one cent.
2. WHEN any such list is split THE SYSTEM SHALL make the balances sum to exactly zero.
3. WHEN any such balances are settled THE SYSTEM SHALL bring every balance to zero with positive whole-cent payments, at most one fewer than the number of people with a non-zero balance.
4. WHEN the same file is read twice, or its lines are given in another order, THE SYSTEM SHALL print the same balances, and the same payments for the same line order.
5. WHEN a property fails THE SYSTEM SHALL report the seed and the smallest failing input it found, so the failure can be replayed.

