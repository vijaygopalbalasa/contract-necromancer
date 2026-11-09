import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    env = dict(os.environ, PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(
        [sys.executable, "-m", "leapage", *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_prints_the_age_on_its_own_line():
    done = run("2000-02-29", "2025-02-28")
    assert (done.returncode, done.stdout, done.stderr) == (0, "24\n", "")
    done = run("2000-02-29", "2025-03-01")
    assert (done.returncode, done.stdout, done.stderr) == (0, "25\n", "")


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["2000-01-01"],
        ["2000-01-01", "2025-01-01", "2026-01-01"],
        ["2025-02-29", "2026-01-01"],
        ["2000-01-01", "2025-2-9"],
        ["2000-01-01", "20250209"],
        ["2025-01-01", "2024-12-31"],
        ["2000-01-01\n", "2025-01-01"],
    ],
)
def test_a_bad_call_exits_1_with_one_line_on_stderr(args):
    done = run(*args)
    assert done.returncode == 1
    assert done.stdout == ""
    assert done.stderr.endswith(".\n") and done.stderr.count("\n") == 1
    assert "Traceback" not in done.stderr
