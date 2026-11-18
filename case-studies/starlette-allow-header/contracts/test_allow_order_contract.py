import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from starlette.responses import PlainTextResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402


async def _plain(request):
    return PlainTextResponse("hello")


def _route():
    return Route("/", _plain, methods=["GET", "POST", "PUT", "DELETE"])


def _call(method):
    """Call the route as a bare ASGI app and return (status, headers, body)."""
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": method,
        "path": "/",
        "root_path": "",
        "query_string": b"",
        "headers": [],
    }
    asyncio.run(_route().handle(scope, receive, send))
    start = messages[0]
    body = b"".join(m.get("body", b"") for m in messages[1:])
    headers = [(k.decode("latin-1"), v.decode("latin-1")) for k, v in start["headers"]]
    return start["status"], headers, body


def test_R1_1_patch_gets_405_with_alphabetical_allow_header():
    status, headers, _ = _call("PATCH")
    allow = [v for k, v in headers if k.lower() == "allow"]
    assert status == 405
    assert allow == ["DELETE, GET, HEAD, POST, PUT"]


def test_R1_1_patch_in_starlette_app_gets_405_with_single_alphabetical_allow_header():
    from starlette.applications import Starlette

    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "PATCH",
        "path": "/",
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "http_version": "1.1",
    }
    app = Starlette(routes=[_route()])
    asyncio.run(app(scope, receive, send))
    start = messages[0]
    allow = [v.decode("latin-1") for k, v in start["headers"] if k.decode("latin-1").lower() == "allow"]
    assert start["status"] == 405
    assert allow == ["DELETE, GET, HEAD, POST, PUT"]
