import json

import pytest
from starlette.websockets import WebSocketDisconnect

from app.config import Settings

AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}


def mock(name):
    return json.loads((Settings(_env_file=None).mocks_dir / name).read_text())


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["auth_mode"] == "dev"
    assert body["agent_mode"] == "scripted"  # no ANTHROPIC_API_KEY


def test_me_requires_auth(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_me_agent_matches_mock(client):
    assert client.get("/api/v1/me", headers=AGENT).json() == mock("me.json")


def test_me_human_home(client):
    assert client.get("/api/v1/me", headers=LINH).json()["home"] == "/incidents"


def test_requests_mock(client):
    r = client.get("/api/v1/requests", headers=LINH)
    assert r.status_code == 200
    assert r.json() == mock("requests.json")


def test_role_gate(client):
    r = client.get("/api/v1/admin/users", headers=LINH)
    assert r.status_code == 403


def test_approve_cycles_variants(client):
    first = client.post("/api/v1/requests/CR-0192/approve", headers=LINH).json()
    second = client.post("/api/v1/requests/CR-0192/approve", headers=LINH).json()
    assert first == mock("request-approve.json")
    assert second == mock("request-approve-2.json")


def test_audit_delete_refused(client):
    r = client.delete("/api/v1/admin/audit/ae_0007", headers={"X-Demo-User": "dave.kim"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "tide_refused"


def test_ws_auth_ok_and_ping(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"v": 1, "type": "auth", "payload": {"demo_user": "linh.tran"}})
        ok = ws.receive_json()
        assert ok["type"] == "auth_ok"
        assert "role:oncall" in ok["payload"]["channels"]
        ws.send_json({"v": 1, "type": "ping", "payload": {}})
        assert ws.receive_json()["type"] == "pong"


@pytest.mark.parametrize("first", [
    {"v": 1, "type": "ping", "payload": {}},
    {"v": 1, "type": "auth", "payload": {"demo_user": "mallory"}},
])
def test_ws_rejects_bad_first_message(client, first):
    with client.websocket_connect("/ws") as ws:
        ws.send_json(first)
        assert ws.receive_json()["payload"]["code"] == "unauthenticated"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_ws_auth_timeout(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401
