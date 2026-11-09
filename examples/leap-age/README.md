# Leap Age

How old is a person on a given day, in whole years? The answer is easy to get subtly wrong in two places: the leap year
rule for century years (1900 and 2100 are not leap years, 2000 is), and the birthday of a person born on 29 February
(here 1 March in a year that is not a leap year).

```
python3 -m leapage 2000-02-29 2025-02-28
24
python3 -m leapage 2000-02-29 2025-03-01
25
```

This is the Python example for Contract Necromancer: the contracts are written with pytest, not Node.

pytest must be installed (`python3 -m pip install pytest`). Python 3.11 or newer is needed, because the contract command
uses `python3 -P`. The project itself uses only the standard library.

## Where things are

- `.kiro/specs/age/`: `requirements.md` (8 criteria in EARS form), `design.md`, `tasks.md` (3 tasks) and
  `runners.json`, which tells the tool how to run the Python contracts.
- `contracts/age/test_*_contract.py`: one pytest test per criterion, named `R1.1 ...` to `R3.2 ...`.
- `leapage/`: the code. `tests/`: unit tests. Run them with `python3 -m pytest tests -q -p no:cacheprovider`.

## Status

Kiro drafted the spec, the contracts, `runners.json` and the code in one session. A person reviewed them and froze the
spec on Nov 10, 2026; Kiro then ticked the three tasks through the gate, which wrote one receipt each in
`.necro/receipts/age/`. Re-run any of them from this folder (pytest must be installed):

```
node ../../bin/necro.js verify .necro/receipts/age/<receipt>.json
```

Because the code was written before the freeze, this example shows the runner and the receipts working for Python;
the gate refusing a planted bug is shown by the tool's own tests (`test/python-example.test.js`).

## The runner

`runners.json` runs each contract file as `python3 -P -m pytest {file} --junitxml={report} -q --noconftest -p no:cacheprovider`.
The report decides the result. A testcase named `R<n>.<m> ...` is the contract for that criterion. A Python function
name cannot hold a dot, so each contract file registers its function under the criterion name, and `pytest.ini` lists
`R[0-9]*.[0-9]*` in `python_functions`. `"sources"` pins `leapage/*.py` in every receipt, and `"frozen"` locks `pytest.ini`
and `pyproject.toml` with the spec.

What this does not defend against is in the [root README](../../README.md#what-runner-contracts-cannot-defend-against):
the code under test runs inside pytest's process, and the gate trusts the installed packages and the interpreter.
