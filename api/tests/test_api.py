import json

import pytest
from starlette.websockets import WebSocketDisconnect

from app.audit_log import append_audit
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


def test_me_agent_matches_mock_shape(client):
    got, want = client.get("/api/v1/me", headers=AGENT).json(), mock("me.json")
    assert set(got) == set(want)
    for k in ("user", "roles", "home", "context_flagged"):
        assert got[k] == want[k]
    states = {a["capability"]: a["state"] for a in got["authority"]}
    assert states == {**{a["capability"]: a["state"] for a in want["authority"]}, "customer_pii.selfdecrypt": "pending"}
    assert got["open_requests"] == 3


def test_me_human_home(client):
    assert client.get("/api/v1/me", headers=LINH).json()["home"] == "/incidents"


def test_role_gate(client):
    r = client.get("/api/v1/admin/users", headers=LINH)
    assert r.status_code == 403


def test_audit_delete_refused(client):
    ev = append_audit(client.app.state.db, actor="ai-oncall-agent", actor_type="agent", action="decrypt_records",
                      target="customer_pii:mrc_8812", outcome="refused")
    r = client.delete(f"/api/v1/admin/audit/{ev['id']}", headers={"X-Demo-User": "dave.kim"})
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
