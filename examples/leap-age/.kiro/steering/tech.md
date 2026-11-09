# Tech
- Python 3.11 or newer, the standard library only. pytest is needed to run the tests and the contracts, and nothing else.
- Unit tests use pytest in `tests/`. Logic lives in `leapage/` as small functions; `leapage/cli.py` only reads arguments and prints.
- Run the tests with `python3 -m pytest tests -q -p no:cacheprovider`.
- Errors shown to users are one short plain sentence on one line that says what to fix.
