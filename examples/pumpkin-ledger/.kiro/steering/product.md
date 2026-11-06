# Product: Pumpkin Ledger
A command-line tool that splits a party's shared costs fairly and says who pays whom, in the fewest payments, to the cent.
Input is a small text file: one line per expense, `<payer> paid <amount> for <what> [split <name>,<name>,...]`.
Without `split`, an expense is shared by everyone named anywhere in the file.
