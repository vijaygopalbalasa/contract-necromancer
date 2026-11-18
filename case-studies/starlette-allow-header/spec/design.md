# Design: deterministic Allow header on a 405

## Overview
`Route.handle` in `starlette/routing.py` builds the 405 `Allow` header with `", ".join(self.methods)`. `self.methods` is a
`set`, so the order follows the process's string hash seed. The fix makes the header text independent of the seed by sorting
the methods before joining.

## Change
In `Route.handle`, replace `", ".join(self.methods)` with `", ".join(sorted(self.methods))`.

- `self.methods` already contains the HEAD that `Route.__init__` adds when GET is accepted, so HEAD appears in the header.
- `sorted` on uppercase strings gives plain alphabetical order. For GET, POST, PUT and DELETE the result is
  `DELETE, GET, HEAD, POST, PUT`.
- `self.methods` stays a set. `__eq__`, `__repr__` and the membership test in `Route.matches` and `Route.handle` are untouched.
- Status code, body (`Method Not Allowed`), and the `content-length` and `content-type` headers come from the unchanged
  `PlainTextResponse` / `HTTPException` code path, so only the `Allow` value changes.

Alternative considered: storing `self.methods` as a sorted list. It would change the type seen by users and by `__eq__`, so it
is rejected in favour of the one-line change at the point of use.

## Verification of each acceptance criterion
The contracts live in `contracts/allow-header/`. They call `Route.handle` directly with a hand-built ASGI scope, `receive` and
`send`, so they need neither httpx nor `TestClient`. Each file puts the repository root on `sys.path` first.

| Criterion | Contract | Check |
| --- | --- | --- |
| 1.1 | `test_allow_order_contract.py::test_R1_1_*` | A route with GET, POST, PUT, DELETE answers PATCH with status 405 and exactly one `Allow` header equal to `DELETE, GET, HEAD, POST, PUT`. |
| 1.1 | `test_allow_order_contract.py::test_R1_1_patch_in_starlette_app_*` | The same route inside `Starlette(routes=[...])`, called directly as an ASGI app (no httpx, no `TestClient`), answers PATCH with status 405 and exactly one `Allow` header equal to `DELETE, GET, HEAD, POST, PUT`. This covers the path where `HTTPException(405)` is turned into a response by Starlette's exception handling. |
| 1.2 | `test_allow_seeds_contract.py::test_R1_2_*` | Four subprocesses (`sys.executable`) run the same request with `PYTHONHASHSEED` 1, 2, 3 and 4 and print the `Allow` value. The four outputs must be non-empty and identical. |
| 1.3 | `test_allow_unchanged_contract.py::test_R1_3_*` | The 405 has body `Method Not Allowed`, and its headers other than `Allow` are exactly `content-length: 18` and `content-type: text/plain; charset=utf-8`. The `Allow` header is present once and contains the same five methods, compared as a set so this check is independent of order. |
| 1.4 | `test_allow_unchanged_contract.py::test_R1_4_*` | A GET to the same route returns 200, body `hello`, and no `Allow` header. |

Expected result on current code: 1.1 and 1.2 fail (set order), 1.3 and 1.4 pass. After the change all four pass.
Run with `python3 -P -m pytest contracts/allow-header -q --noconftest -p no:cacheprovider`.
