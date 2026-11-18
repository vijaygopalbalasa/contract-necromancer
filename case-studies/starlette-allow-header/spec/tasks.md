# Tasks: allow-header

- [x] 1. In `Route.handle` (`starlette/routing.py`), build the 405 `Allow` header with `", ".join(sorted(self.methods))` and leave the status, body and other headers and the allowed-method path unchanged (Req 1.1, 1.2, 1.3, 1.4)
