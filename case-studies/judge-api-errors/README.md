# Case study: a real fix in Judge Protocol, gated by Contract Necromancer

Judge Protocol (https://github.com/vijaygopalbalasa/judge-protocol) is my own live project: a deterministic evaluator for
ERC-8183 agent escrow on Arc. Its `judge-service` is a Node.js HTTP API. On Nov 9 I installed the gate in it with
`necro init` and used it for one real maintenance job, start to finish.

## The bugs

Kiro found them in a read-only review (`build-case-scout.txt`); I confirmed them in the code.

1. `src/http.js` answered every unexpected error with `500 { error: e.message }`. When the chain RPC fails, viem's error
   message contains the RPC URL, and an RPC URL can carry a provider API key. So a caller of `GET /verdict/:jobId` could
   read it.
2. `GET /evidence/:jobId` served any file starting `job-<id>-`, so a sibling file such as `job-186820-arbitration.json`
   (a real file name in that repository) could be served as the job's evidence.

## How it went

1. I wrote the requirements in EARS form (`spec/requirements.md`): 6 criteria.
2. Kiro drafted the design, three tasks and one contract per criterion (`spec/`, `contracts/`). Run against the old
   code, 5 of the 6 contracts failed. The one that passed (R1.4) guards behaviour that must not change.
3. I reviewed the contracts and froze the spec.
4. Kiro built the three tasks, unit tests first (`build-case-build.txt`).
5. **The gate refused the first tick.** After task 1, Kiro tried to tick it, and the gate answered
   `Contracts failed: R1.3 both the 502 and the 500 write the full error to stderr`. Task 1 had made the 500 path log the
   full error, but the chain-read path (task 2) did not exist yet, and R1.3 requires both. Kiro read the contract, built
   task 2, and the tick of task 1 then went through. Without the gate, task 1 would have been ticked with half of a
   criterion it names.
6. Tasks 2 and 3 were accepted on the first try. The final receipt shows all 6 contracts passing. The service's own
   unit tests went from 325 to 333, all passing.

The fix itself is small (`http.js.diff`): the chain read is wrapped and answers `502 {"error":"upstream chain read
failed"}`, anything else unexpected answers `500 {"error":"internal error"}`, the full error goes to the server log, and
evidence matches only `job-<id>-<hex>.json`.

## The receipts

`receipts/` holds the three receipts the gate wrote, one per accepted tick. Run in the judge-protocol working tree:

- `bc99f504...` (task 3, all 6 contracts pass): `CONFIRMED`.
- `f31db847...` (task 1) and `4a9549e0...` (task 2): `MISMATCH`, because when they were written the evidence contracts
  R2.1 and R2.2 were still failing (not required for those tasks), and they pass now. A receipt is a snapshot of
  that moment; this is the verifier noticing that the world moved on.

## Honest status

The change is merged into judge-protocol ([pull request #29](https://github.com/vijaygopalbalasa/judge-protocol/pull/29),
Nov 12 2026). In a clone of that repository, run from `judge-service/`,
`necro verify .necro/receipts/api-errors/bc99f504b6460d31fb279cb986dfc70e4e65c70598518ec011f77fb9ea8a88f9.json`
prints CONFIRMED. This folder also keeps the spec, contracts, receipts, diff, unit tests and the Kiro logs (local paths
replaced with `<home>`). The requirements are mine; Kiro drafted the design, tasks and contracts and wrote the code and
tests.
