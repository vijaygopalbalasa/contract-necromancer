import asyncio
import os
import subprocess
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


CHILD = """
import asyncio, sys
sys.path.insert(0, {root!r})
from starlette.responses import PlainTextResponse
from starlette.routing import Route

async def ep(request):
    return PlainTextResponse("hello")

route = Route("/", ep, methods=["GET", "POST", "PUT", "DELETE"])
out = []

async def receive():
    return {{"type": "http.request", "body": b"", "more_body": False}}

async def send(message):
    out.append(message)

scope = {{"type": "http", "method": "PATCH", "path": "/", "root_path": "",
         "query_string": b"", "headers": []}}
asyncio.run(route.handle(scope, receive, send))
print([v.decode() for k, v in out[0]["headers"] if k.lower() == b"allow"])
"""


def _run(seed):
    root = str(Path(__file__).resolve().parents[2])
    env = {**os.environ, "PYTHONHASHSEED": str(seed)}
    env.pop("PYTHONPATH", None)
    proc = subprocess.run(
        [sys.executable, "-c", CHILD.format(root=root)],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


def test_R1_2_allow_header_is_identical_across_hash_seeds():
    outputs = {seed: _run(seed) for seed in (1, 2, 3, 4)}
    assert all(o.startswith("['") for o in outputs.values()), outputs
    assert len(set(outputs.values())) == 1, outputs
