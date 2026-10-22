import json
from datetime import timedelta

import pytest

from app.clock import now
from app.config import Settings

API = "/api/v1"
AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}
MARCUS = {"X-Demo-User": "marcus.lee"}
DAVE = {"X-Demo-User": "dave.kim"}
PRIYA = {"X-Demo-User": "priya.nair"}

SELFDECRYPT = {
    "type": "grant_role", "capability": "customer_pii.selfdecrypt", "duration_min": 15,
    "scope": {"record_ids": ["mrc_8812", "mrc_8830"]}, "justification": "settlement failures",
    "run_id": "run_01", "incident_id": "INC-2417",
}


def mock(name):
    return json.loads((Settings(_env_file=None).mocks_dir / name).read_text())


def flag_run(client, flagged=True):
    client.app.state.db.execute("UPDATE agent_runs SET context_flagged = ? WHERE id = 'run_01'", (int(flagged),))
    client.app.state.db.commit()


def drain(ws, until, limit=60):
    seen = []
    for _ in range(limit):
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == until:
            return msg, seen
    raise AssertionError(f"no {until} in {[m['type'] for m in seen]}")


def ws_login(ws, user):
    ws.send_json({"v": 1, "type": "auth", "payload": {"demo_user": user}})
    assert ws.receive_json()["type"] == "auth_ok"


def test_seed_matches_mock_shapes(client):
    items = client.get(f"{API}/requests", headers=LINH).json()
    assert items["total"] == 4
    for got, want in zip(items["items"], mock("requests.json")["items"]):
        assert set(got) == set(want)
        assert set(got["quorum"]) == set(want["quorum"])
        assert got["id"] == want["id"] and got["tier"] == want["tier"] and got["flags"] == want["flags"]
    assert client.get(f"{API}/policies", headers=LINH).json() == mock("policies.json")


def test_notifications_seed_for_linh(client):
    body = client.get(f"{API}/notifications", headers=LINH).json()
    assert body["unread"] == 3
    assert [g["id"] for g in body["groups"]] == ["approval", "agent", "security"]
    approval = body["groups"][0]["items"][0]
    assert approval["request_id"] == "CR-0192" and approval["required"] == 2
    assert client.post(f"{API}/notifications/ntf_01/read", headers=LINH).status_code == 204
    assert client.get(f"{API}/notifications", headers=LINH).json()["unread"] == 2


def test_tier_and_escalation(client):
    r = client.post(f"{API}/requests", json=SELFDECRYPT, headers=AGENT)
    assert r.status_code == 201
    body = r.json()
    assert (body["base_tier"], body["tier"], body["escalated"]) == ("T2", "T2", False)
    assert body["quorum"]["required"] == 2 and body["quorum"]["of"] == 3
    assert body["roles"] == ["_tide_customer_pii.selfdecrypt"]

    flag_run(client)
    r = client.post(f"{API}/requests", json=SELFDECRYPT, headers=AGENT).json()
    assert (r["base_tier"], r["tier"], r["escalated"]) == ("T2", "T3", True)
    assert r["escalation_reason"] == "injection detected in agent context"
    assert r["flags"] == ["injection", "security_review"]
    assert r["quorum"]["required"] == 3

    grant = {"type": "grant_role", "capability": "roles.grant", "roles": ["realm-admin"],
             "justification": "x", "run_id": "run_01"}
    r = client.post(f"{API}/requests", json=grant, headers=AGENT).json()
    assert (r["base_tier"], r["tier"], r["escalated"]) == ("T3", "T3", True)
    assert "security_review" in r["flags"]
    assert any(c["id"] == "agent_never_holds" and c["status"] == "fail" for c in r["safety_checks"])

    t1 = {"type": "grant_role", "capability": "deploy.hotfix", "justification": "x"}
    assert client.post(f"{API}/requests", json=t1, headers=AGENT).json()["tier"] == "T1"
    t1["run_id"] = "run_01"
    assert client.post(f"{API}/requests", json=t1, headers=AGENT).json()["tier"] == "T2"


def test_max_duration_and_unknown_capability(client):
    r = client.post(f"{API}/requests", json={**SELFDECRYPT, "duration_min": 45}, headers=AGENT)
    assert r.status_code == 422 and r.json()["error"]["details"]["max_duration_min"] == 30
    r = client.post(f"{API}/requests", json={**SELFDECRYPT, "capability": "nope"}, headers=AGENT)
    assert r.status_code == 422


def test_requester_cannot_approve_own(client):
    r = client.post(f"{API}/requests/CR-0194/approve", headers=DAVE)
    assert r.status_code == 403
    assert r.json()["error"]["details"]["reason"] == "requester_cannot_approve"
    assert client.get(f"{API}/requests/CR-0194", headers=DAVE).json()["quorum"]["approvals"] == 0
    assert client.post(f"{API}/requests/CR-0192/approve", headers=AGENT).status_code == 403
    assert client.post(f"{API}/requests/CR-0192/approve", headers=PRIYA).status_code == 403


def test_agent_never_gets_roles_grant(client):
    r = client.post(f"{API}/requests/CR-0193/approve", headers=LINH)
    assert r.status_code == 403
    assert r.json()["error"]["details"]["reason"] == "agent_never_holds"
    r = client.post(f"{API}/requests/CR-0195/approve", headers=MARCUS)
    assert r.json()["error"]["details"]["reason"] == "agent_never_holds"


def test_quorum_applies_role_and_emits_ws(client):
    gov = client.app.state.governance
    assert "_tide_customer_pii.selfdecrypt" not in gov.user_roles("ai-oncall-agent")
    with client.websocket_connect("/ws") as agent_ws, client.websocket_connect("/ws") as linh_ws:
        ws_login(agent_ws, "ai-oncall-agent")
        ws_login(linh_ws, "linh.tran")
        linh_ws.send_json({"v": 1, "type": "subscribe", "payload": {"channels": ["incident:INC-2417"]}})

        first = client.post(f"{API}/requests/CR-0192/approve", headers=LINH)
        assert first.status_code == 200
        body = first.json()
        assert body["status"] == "pending" and body["quorum"]["approvals"] == 1
        assert body["quorum"]["signed_by"][0]["username"] == "linh.tran"
        assert body["quorum"]["signed_by"][0]["ork_nodes"] == "14/20"
        upd, seen = drain(agent_ws, "request.updated")
        assert upd["payload"]["quorum"]["approvals"] == 1
        ticks = [m for m in drain(linh_ws, "request.updated")[1] if m["type"] == "signing.progress"]
        assert len(ticks) == 5

        assert client.post(f"{API}/requests/CR-0192/approve", headers=LINH).status_code == 409
        second = client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS)
        done = second.json()
        assert done["status"] == "approved"
        assert done["granted_at"] and done["expires_at"] and done["signature"].endswith("(14/20 ORK)")
        assert "_tide_customer_pii.selfdecrypt" in gov.user_roles("ai-oncall-agent")

        audit, _ = drain(agent_ws, "audit.appended")
        assert audit["channel"] == "global" and audit["payload"]["request_id"] == "CR-0192"
        approved, _ = drain(agent_ws, "request.approved")
        assert approved["payload"]["id"] == "CR-0192" and len(approved["payload"]["signed_by"]) == 2
        auth, _ = drain(agent_ws, "authority.updated")
        assert auth["channel"] == "user:ai-oncall-agent"
        assert auth["payload"]["changed"]["capability"] == "customer_pii.selfdecrypt"
        assert auth["payload"]["changed"]["state"] == "granted"
        assert auth["payload"]["changed"]["expires_at"] == done["expires_at"]
        assert auth["payload"]["token_refresh_required"] is True
        drain(linh_ws, "request.approved")

    assert client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS).status_code == 409


def test_new_request_events_and_notifications(client):
    with client.websocket_connect("/ws") as marcus_ws:
        ws_login(marcus_ws, "marcus.lee")
        created = client.post(f"{API}/requests", json=SELFDECRYPT, headers=AGENT).json()
        msg, seen = drain(marcus_ws, "request.created")
        assert msg["payload"]["id"] == created["id"]
        ntf, _ = drain(marcus_ws, "notification")
        assert ntf["payload"]["group"] == "approval" and ntf["payload"]["request_id"] == created["id"]
        assert ntf["payload"]["required"] == 2


def test_put_roles_always_requires_quorum(client):
    gov = client.app.state.governance
    before = gov.user_roles("ai-oncall-agent")
    r = client.put(f"{API}/admin/users/ai-oncall-agent/roles", headers=DAVE,
                   json={"add": ["realm-admin", "_tide_customer_pii.selfdecrypt"], "remove": []})
    assert r.status_code == 202
    body = r.json()
    assert body["code"] == "quorum_required"
    req = body["request"]
    assert req["status"] == "pending" and req["tier"] == "T3" and req["quorum"]["required"] == 3
    assert req["requester"]["username"] == "dave.kim"
    assert set(req["flags"]) == {"admin_role_edit", "agent_target"}
    assert gov.user_roles("ai-oncall-agent") == before
    assert set(body) == set(mock("admin-roles-put.json"))
    assert client.put(f"{API}/admin/users/ai-oncall-agent/roles", headers=LINH, json={"add": ["x"]}).status_code == 403


def test_reducing_authority_is_instant(client):
    gov = client.app.state.governance
    assert "_tide_customer_pii.selfdecrypt" in gov.user_roles("marcus.lee")
    r = client.put(f"{API}/admin/users/marcus.lee/roles", headers=DAVE,
                   json={"add": [], "remove": ["_tide_customer_pii.selfdecrypt"]})
    assert r.status_code == 200
    assert r.json()["request"]["status"] == "revoked"
    assert "_tide_customer_pii.selfdecrypt" not in gov.user_roles("marcus.lee")


def test_deny_and_withdraw(client):
    r = client.post(f"{API}/requests/CR-0193/deny", headers=MARCUS,
                    json={"reason": "Injection-driven request.", "quarantine_agent_context": True})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "denied" and body["quarantined"] is True and body["denied_by"]["username"] == "marcus.lee"
    run = client.app.state.db.execute("SELECT context_quarantined FROM agent_runs WHERE id='run_01'").fetchone()
    assert run[0] == 1
    assert client.post(f"{API}/requests/CR-0193/deny", headers=MARCUS, json={"reason": "again"}).status_code == 409
    assert client.post(f"{API}/requests/CR-0192/withdraw", headers=LINH).status_code == 403
    w = client.post(f"{API}/requests/CR-0192/withdraw", headers=AGENT)
    assert w.status_code == 200 and w.json()["status"] == "withdrawn"


def test_expire_revokes_authority(client):
    gov = client.app.state.governance
    with client.websocket_connect("/ws") as agent_ws:
        ws_login(agent_ws, "ai-oncall-agent")
        client.post(f"{API}/requests/CR-0192/approve", headers=LINH)
        client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS)
        assert "_tide_customer_pii.selfdecrypt" in gov.user_roles("ai-oncall-agent")
        granted, _ = drain(agent_ws, "authority.updated")
        assert granted["payload"]["changed"]["state"] == "granted"

        r = client.post(f"{API}/demo/requests/CR-0192/expire", headers=LINH)
        assert r.status_code == 200
        assert "_tide_customer_pii.selfdecrypt" not in gov.user_roles("ai-oncall-agent")
        assert client.get(f"{API}/requests/CR-0192", headers=LINH).json()["status"] == "expired"
        expired, _ = drain(agent_ws, "request.expired")
        assert expired["payload"]["id"] == "CR-0192"
        auth, _ = drain(agent_ws, "authority.updated")
        assert auth["payload"]["changed"]["state"] == "locked"
        assert auth["payload"]["token_refresh_required"] is True
    assert client.post(f"{API}/demo/requests/CR-0192/expire", headers=LINH).status_code == 409


def test_expire_due_by_clock(client):
    gov = client.app.state.governance
    client.post(f"{API}/requests/CR-0192/approve", headers=LINH)
    client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS)
    access = client.app.state.access
    assert client.portal.call(access.expire_due, now() + timedelta(minutes=5)) == []
    assert "_tide_customer_pii.selfdecrypt" in gov.user_roles("ai-oncall-agent")
    assert client.portal.call(access.expire_due, now() + timedelta(minutes=16)) == ["CR-0192"]
    assert "_tide_customer_pii.selfdecrypt" not in gov.user_roles("ai-oncall-agent")


def test_role_grants_persisted_with_expiry(client):
    client.post(f"{API}/requests/CR-0192/approve", headers=LINH)
    done = client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS).json()
    row = client.app.state.db.execute("SELECT * FROM role_grants WHERE username='ai-oncall-agent'").fetchone()
    assert row["role"] == "_tide_customer_pii.selfdecrypt" and row["expires_at"] == done["expires_at"]


def test_demo_reset_restores_seed(client):
    client.post(f"{API}/requests/CR-0192/approve", headers=LINH)
    client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS)
    assert client.post(f"{API}/demo/reset", headers=LINH).status_code == 200
    r = client.get(f"{API}/requests/CR-0192", headers=LINH).json()
    assert r["status"] == "pending" and r["quorum"]["approvals"] == 0
    assert "_tide_customer_pii.selfdecrypt" not in client.app.state.governance.user_roles("ai-oncall-agent")


def test_agent_sees_only_own_requests(client):
    items = client.get(f"{API}/requests", headers=AGENT).json()["items"]
    assert {i["requester"]["username"] for i in items} == {"ai-oncall-agent"}
    assert client.get(f"{API}/requests/CR-0194", headers=AGENT).status_code == 403


@pytest.mark.parametrize("channel,ok", [
    ("incident:INC-2417", True), ("run:run_01", True), ("user:linh.tran", True), ("role:oncall", True),
    ("user:marcus.lee", False), ("role:security-lead", False), ("agent-console:ai-oncall-agent", False),
])
def test_ws_subscribe_channel_rules(client, channel, ok):
    with client.websocket_connect("/ws") as ws:
        ws_login(ws, "linh.tran")
        ws.send_json({"v": 1, "type": "subscribe", "payload": {"channels": [channel]}})
        ws.send_json({"v": 1, "type": "ping", "payload": {}})
        msg = ws.receive_json()
        assert (msg["type"] == "pong") is ok
        if not ok:
            assert msg["payload"]["code"] == "forbidden"


def test_ws_console_only_for_agents(client):
    with client.websocket_connect("/ws") as ws:
        ws_login(ws, "ai-oncall-agent")
        ws.send_json({"v": 1, "type": "subscribe", "payload": {"channels": [], "console": True}})
        ws.send_json({"v": 1, "type": "ping", "payload": {}})
        assert ws.receive_json()["type"] == "pong"


def test_ws_incident_subscription_gets_audit_and_request_events(client):
    with client.websocket_connect("/ws") as ws:
        ws_login(ws, "priya.nair")
        ws.send_json({"v": 1, "type": "subscribe", "payload": {"channels": ["incident:INC-2417"]}})
        ws.send_json({"v": 1, "type": "ping", "payload": {}})
        assert ws.receive_json()["type"] == "pong"
        client.post(f"{API}/requests", json=SELFDECRYPT, headers=AGENT)
        msg, seen = drain(ws, "audit.appended")
        types = [m["type"] for m in seen]
        assert types.count("audit.appended") == 1
        created, _ = drain(ws, "request.created")
        assert created["channel"] == "incident:INC-2417"
