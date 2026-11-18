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


def test_R1_3_405_keeps_status_body_and_other_headers():
    status, headers, body = _call("PATCH")
    assert status == 405
    assert body == b"Method Not Allowed"
    others = sorted((k.lower(), v) for k, v in headers if k.lower() != "allow")
    assert others == [
        ("content-length", "18"),
        ("content-type", "text/plain; charset=utf-8"),
    ]
    allow = [v for k, v in headers if k.lower() == "allow"]
    assert len(allow) == 1
    assert sorted(allow[0].split(", ")) == ["DELETE", "GET", "HEAD", "POST", "PUT"]


def test_R1_4_accepted_method_still_answers_200_with_body():
    status, headers, body = _call("GET")
    assert status == 200
    assert body == b"hello"
    assert not [v for k, v in headers if k.lower() == "allow"]
