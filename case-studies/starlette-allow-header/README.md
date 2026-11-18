# Case study: a nondeterministic Allow header in Starlette, gated by Contract Necromancer

Starlette (https://github.com/Kludex/starlette) is a Python web framework I do not own. Issue
[Kludex/starlette#3793](https://github.com/Kludex/starlette/issues/3793) reports that a 405 response lists its allowed
methods in a different order in different processes. On Nov 18 I installed the gate in a fresh clone at main `271c277`,
the way a new user would, and ran one fix through it, start to finish. Nothing was sent to the Starlette repository.
Starlette's repository now lives at Kludex/starlette (git still follows the old encode/starlette address; its issue
links do not). The frozen requirement names the issue by the old address, because changing it would change the hash
the receipt pins.

## The bug

`Route.handle` in `starlette/routing.py` builds the 405 `Allow` header with `", ".join(self.methods)`, and `self.methods`
is a set, so the order follows the process's hash seed. For a route that accepts GET, POST, PUT and DELETE, a PATCH got
`HEAD, GET, PUT, DELETE, POST` under `PYTHONHASHSEED=1`, `GET, PUT, HEAD, DELETE, POST` under 2,
`DELETE, GET, PUT, POST, HEAD` under 3 and `HEAD, POST, PUT, GET, DELETE` under 4.

## How it went

1. Installed the tool from GitHub into a fresh npm prefix (6 s) and ran `necro init` in the clone (under 1 s). It wrote
   the four hooks, the steering file and the custom agent.
2. I wrote the requirement in EARS form, four criteria (`spec/requirements.md`), and `spec/runners.json`, which runs the
   pytest contracts and freezes Starlette's `pyproject.toml`, because its pytest settings decide how the contracts run.
3. Kiro drafted the design, one task and one contract per criterion in 53 s (`build-case-draft.txt`; the prompts are
   `prompt-*.txt`). Run on the old code, the 1.1 and 1.2 contracts failed and 1.3 and 1.4 passed.
4. My review found a gap: the contracts called the route on its own, but inside a Starlette application the 405 is
   raised as an `HTTPException` and built by Starlette's exception handling. A fix applied only to the bare path would
   have passed. Kiro added a second 1.1 contract for the application path in 32 s (`build-case-review.txt`).
5. Before freezing, I ran the contracts against six versions of `routing.py` ([red-proofs.md](red-proofs.md)): the
   correct fix passes all five, and each wrong fix fails the contract it breaks, including the bare-path-only fix.
6. I froze the spec (7 s). Kiro built task 1 under the gate in 40 s (`build-case-build.txt`): one line,
   `", ".join(sorted(self.methods))` (`routing.py.diff`). The gate ran the five frozen contracts on the tick, accepted
   it and wrote the receipt in `receipts/`. Kiro got it right on the first try (the issue itself proposes this line), so this case shows no
   refusal; the Judge Protocol case does.
7. `necro verify` on the receipt prints `CONFIRMED`. With the fix undone it prints
   `MISMATCH. Files changed: starlette/routing.py.` I ran Starlette's own routing tests with the fix: 64 passed (Kiro could not, because its environment had no
   httpx2).

The three Kiro sessions used 1.76 credits in total.

## What I learned

Starlette's pytest settings name a warning class from `starlette.exceptions`, so pytest imports Starlette before any
contract runs, from wherever the environment finds it. Install the project itself (`pip install -e .`) in the
environment that runs the contracts. In my first red-proof run I tested patched copies of the project while the
editable install still pointed at the original folder, and the contracts tested the original code until I patched in
place.

## Why it was not sent upstream

The reporter of #3793 already published the same one-line fix on a branch, and Starlette's `AI_POLICY.md` asks
contributors not to open a pull request for a change that has already been proposed. So this stays a case study.

## Re-check it

Node.js 24, git and Python 3.11 or newer. From an empty folder, with this repository cloned beside it as
`contract-necromancer`:

```
git clone https://github.com/Kludex/starlette && cd starlette && git checkout 271c277
git apply ../contract-necromancer/case-studies/starlette-allow-header/routing.py.diff
mkdir -p .kiro/specs/allow-header contracts/allow-header .necro/receipts/allow-header
cp ../contract-necromancer/case-studies/starlette-allow-header/spec/* .kiro/specs/allow-header/
cp ../contract-necromancer/case-studies/starlette-allow-header/contracts/* contracts/allow-header/
cp ../contract-necromancer/case-studies/starlette-allow-header/necro/lock.json .necro/
cp ../contract-necromancer/case-studies/starlette-allow-header/receipts/*.json .necro/receipts/allow-header/
python3 -m venv .venv && . .venv/bin/activate && pip install -e . pytest
npx -y github:vijaygopalbalasa/contract-necromancer verify .necro/receipts/allow-header/8cc5dc430387f061a29f2026d6bc399fd26e6b4b6837d6ad8c9dea7eb27d1356.json
```

It prints `CONFIRMED`. Here, inside this repository, the same receipt prints `OTHER PROJECT`, because it was written in
the Starlette clone.
