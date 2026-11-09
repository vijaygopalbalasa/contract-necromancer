"""Contracts for Requirement 3 (command line) of the age spec: one test per criterion.

Each test is registered under the name of its criterion, for example "R3.1 ...", so the pytest report names the
testcase that way and the gate can match a task's criteria to it. The command is run as a user runs it, in a new
process, and only its standard output, error output and exit code are read.
"""
import os
import subprocess
import sys
from pathlib import Path

# `python3 -P` keeps the project folder off the import path. The command under test is a new process that gets it from PYTHONPATH.
ROOT = Path(__file__).resolve().parents[2]


def contract(name):
    """Register the decorated function in this module under `name` (a Python function name cannot hold a dot)."""

    def register(function):
        globals()[name] = function

    return register


def leapage(*args):
    env = dict(os.environ, PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    return subprocess.run(
        [sys.executable, "-m", "leapage", *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


@contract("R3.1 two YYYY-MM-DD dates print the age as a whole number on a line of its own and exit with code 0")
def prints_the_age():
    cases = [
        (("2000-02-29", "2025-02-28"), "24\n"),
        (("2000-02-29", "2025-03-01"), "25\n"),
        (("2000-06-15", "2025-06-14"), "24\n"),
        (("2000-06-15", "2025-06-15"), "25\n"),
        (("1896-02-29", "1900-02-28"), "3\n"),
        (("1896-02-29", "1900-03-01"), "4\n"),
        (("2000-01-01", "2000-01-01"), "0\n"),
        (("1900-01-01", "2025-01-01"), "125\n"),
    ]
    for args, expected in cases:
        done = leapage(*args)
        assert done.returncode == 0, f"{args}: exit code {done.returncode}, error output {done.stderr!r}"
        assert done.stdout == expected, f"{args}: printed {done.stdout!r}, expected {expected!r}"
        assert done.stderr == "", f"{args}: error output {done.stderr!r}"


@contract("R3.2 a bad date, a day before birth or a wrong number of arguments gives one line on stderr, nothing on stdout, exit code 1")
def refuses_bad_calls():
    bad = [
        (),
        ("2000-01-01",),
        ("2000-01-01", "2025-01-01", "2026-01-01"),
        ("2025-02-29", "2026-01-01"),
        ("2000-01-01", "2025-02-29"),
        ("2000-02-30", "2026-01-01"),
        ("1900-02-29", "2026-01-01"),
        ("2000-01-01", "2025-2-9"),
        ("2000-1-01", "2025-02-09"),
        ("2000-01-01", "20250209"),
        ("2000-01-01", "2025-W06-1"),
        ("2000-01-01", "2025-02-09 "),
        ("2000-01-01\n", "2025-02-09"),
        ("2000-01-01", "2025-02-09\n"),
        ("2000-01-01", "\uff12\uff10\uff12\uff15-02-09"),
        ("0000-01-01", "2025-02-09"),
        ("2000-13-01", "2025-02-09"),
        ("2000-00-10", "2025-02-09"),
        ("2000-04-31", "2025-02-09"),
        ("", ""),
        ("2025-01-01", "2024-12-31"),
        ("2000-02-29", "2000-02-28"),
    ]
    for args in bad:
        done = leapage(*args)
        assert done.returncode == 1, f"{args!r}: exit code {done.returncode}, expected 1"
        assert done.stdout == "", f"{args!r}: standard output {done.stdout!r}, expected nothing"
        assert done.stderr.endswith("\n") and done.stderr.count("\n") == 1 and done.stderr.strip() != "", f"{args!r}: error output {done.stderr!r}, expected one line"
        assert "Traceback" not in done.stderr, f"{args!r}: error output {done.stderr!r}"
