"""In-memory WS hub. Protocol: docs/API.md §6."""
import asyncio
import uuid
from collections.abc import Iterable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import User, user_from_credential
from .clock import TZ, iso, now  # noqa: F401  (TZ re-exported)
from .errors import ApiError

router = APIRouter()


def envelope(type_: str, payload: dict, channel: str | None = None) -> dict:
    return {"v": 1, "id": f"evt_{uuid.uuid4().hex[:12]}", "ts": iso(now()),
            "type": type_, "channel": channel, "payload": payload}


class Connection:
    def __init__(self, ws: WebSocket, user: User):
        self.ws, self.user = ws, user
        self.channels: set[str] = {f"user:{user.username}", "global", *(f"role:{r}" for r in user.roles)}

    def may_subscribe(self, channel: str) -> bool:
        kind, _, name = channel.partition(":")
        if kind in ("incident", "run"):
            return bool(name)
        return channel in self.channels

    async def send(self, msg: dict) -> None:
        await self.ws.send_json(msg)


class Hub:
    def __init__(self) -> None:
        self.conns: set[Connection] = set()
        self.pending_tool_calls: dict[str, asyncio.Future] = {}
        self.listeners: list = []

    async def publish(self, channels: str | Iterable[str], type_: str, payload: dict) -> None:
        """Send once per connection, tagged with the first matching channel."""
        wanted = [channels] if isinstance(channels, str) else list(dict.fromkeys(channels))
        for fn in self.listeners:
            fn(type_, payload)
        for c in list(self.conns):
            match = next((ch for ch in wanted if ch in c.channels), None)
            if match is None:
                continue
            try:
                await c.send(envelope(type_, payload, match))
            except Exception:
                self.conns.discard(c)

    def resolve_tool_result(self, payload: dict) -> None:
        fut = self.pending_tool_calls.pop(payload.get("call_id", ""), None)
        if fut and not fut.done():
            fut.set_result(payload)


async def _reject(ws: WebSocket, message: str) -> None:
    await ws.send_json(envelope("error", {"code": "unauthenticated", "message": message}))
    await ws.close(code=4401)


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    app = ws.app
    hub: Hub = app.state.hub
    settings = app.state.settings
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=settings.ws_auth_timeout_s)
    except (asyncio.TimeoutError, ValueError):
        return await _reject(ws, f"auth message required within {settings.ws_auth_timeout_s:g}s")
    except WebSocketDisconnect:
        return
    if not isinstance(first, dict) or first.get("type") != "auth":
        return await _reject(ws, "first message must be auth")
    p = first.get("payload") or {}
    try:
        user = user_from_credential(token=p.get("token"), demo_user=p.get("demo_user"), settings=settings)
    except ApiError as e:
        return await _reject(ws, e.message)

    conn = Connection(ws, user)
    hub.conns.add(conn)
    await conn.send(envelope("auth_ok", {"user": user.username, "channels": sorted(conn.channels)}))
    try:
        while True:
            msg = await ws.receive_json()
            t, p = msg.get("type"), msg.get("payload") or {}
            if t == "ping":
                await conn.send(envelope("pong", {}))
            elif t == "subscribe":
                for ch in p.get("channels", []):
                    if not isinstance(ch, str) or not conn.may_subscribe(ch):
                        await conn.send(envelope("error", {"code": "forbidden", "message": f"cannot subscribe to {ch!r}"}))
                    else:
                        conn.channels.add(ch)
                if p.get("console"):
                    if user.type == "agent":
                        conn.channels.add(f"agent-console:{user.username}")
                    else:
                        await conn.send(envelope("error", {"code": "forbidden", "message": "console is for agents"}))
            elif t == "unsubscribe":
                conn.channels.difference_update(p.get("channels", []))
            elif t == "tool_result":
                if user.type == "agent":
                    hub.resolve_tool_result(p)
                else:
                    await conn.send(envelope("error", {"code": "forbidden", "message": "tool_result is for agents"}))
            else:
                await conn.send(envelope("error", {"code": "validation_error", "message": f"unknown type {t!r}"}))
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        hub.conns.discard(conn)
