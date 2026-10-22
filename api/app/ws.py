"""In-memory WS hub. Protocol: docs/API.md §6."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import User, user_from_credential
from .errors import ApiError

TZ = timezone(timedelta(hours=7))
router = APIRouter()


def envelope(type_: str, payload: dict, channel: str | None = None) -> dict:
    return {"v": 1, "id": f"evt_{uuid.uuid4().hex[:12]}", "ts": datetime.now(TZ).isoformat(timespec="seconds"),
            "type": type_, "channel": channel, "payload": payload}


class Connection:
    def __init__(self, ws: WebSocket, user: User):
        self.ws, self.user = ws, user
        self.channels: set[str] = {f"user:{user.username}", "global", *(f"role:{r}" for r in user.roles)}

    async def send(self, msg: dict) -> None:
        await self.ws.send_json(msg)


class Hub:
    def __init__(self) -> None:
        self.conns: set[Connection] = set()
        self.pending_tool_calls: dict[str, asyncio.Future] = {}

    async def publish(self, channel: str, type_: str, payload: dict) -> None:
        msg = envelope(type_, payload, channel)
        for c in [c for c in self.conns if channel in c.channels]:
            try:
                await c.send(msg)
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
                conn.channels.update(c for c in p.get("channels", []) if isinstance(c, str))
                if p.get("console") and user.type == "agent":
                    conn.channels.add(f"agent-console:{user.username}")
            elif t == "unsubscribe":
                conn.channels.difference_update(p.get("channels", []))
            elif t == "tool_result":
                hub.resolve_tool_result(p)
            else:
                await conn.send(envelope("error", {"code": "validation_error", "message": f"unknown type {t!r}"}))
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        hub.conns.discard(conn)
