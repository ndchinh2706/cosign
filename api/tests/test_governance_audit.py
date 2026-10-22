import json

from app.audit_log import append_audit
from app.config import Settings

API = "/api/v1"
AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}
MARCUS = {"X-Demo-User": "marcus.lee"}
DAVE = {"X-Demo-User": "dave.kim"}
PRIYA = {"X-Demo-User": "priya.nair"}
ROLE = "_tide_customer_pii.selfdecrypt"


def mock(name):
    return json.loads((Settings(_env_file=None).mocks_dir / name).read_text())


def approve_192(client):
    assert client.post(f"{API}/requests/CR-0192/approve", headers=LINH).status_code == 200
    return client.post(f"{API}/requests/CR-0192/approve", headers=MARCUS).json()


def authority(client, user=AGENT):
    return {a["capability"]: a for a in client.get(f"{API}/me", headers=user).json()["authority"]}


def test_me_reflects_grant_after_quorum(client):
    assert ROLE not in client.get(f"{API}/me", headers=AGENT).json()["roles"]
    done = approve_192(client)
    me = client.get(f"{API}/me", headers=AGENT).json()
    assert ROLE in me["roles"]
    cell = me["authority"][3]
    assert cell["capability"] == "customer_pii.selfdecrypt" and cell["state"] == "granted"
    assert cell["expires_at"] == done["expires_at"] and cell["tide_role"] == ROLE
    assert me["open_requests"] == 2
    assert authority(client, MARCUS)["customer_pii.selfdecrypt"]["state"] == "allowed"


def test_me_human_home_follows_roles(client):
    assert client.get(f"{API}/me", headers=MARCUS).json()["home"] == "/governance"
    assert client.get(f"{API}/me", headers=PRIYA).json()["home"] == "/audit"


def test_governance_overview_and_map_from_state(client):
    ov = client.get(f"{API}/governance/overview", headers=MARCUS).json()
    want = mock("governance-overview.json")
    assert set(ov) == set(want) and set(ov["stats"]) == set(want["stats"])
    assert ov["stats"]["pending_change_requests"] == 4 and ov["stats"]["policy_version"] == "v7"
    assert ov["stats"]["policy_signed"] is True
    assert [q["id"] for q in ov["queue"]] == ["CR-0192", "CR-0193", "CR-0194", "CR-0195"]
    q192 = ov["queue"][0]
    assert set(q192) == set(want["queue"][0]) and q192["change"] == "grant customer_pii.selfdecrypt (15m, 5 records)"
    assert ov["queue"][2]["change"].endswith("to self")

    amap = client.get(f"{API}/governance/authority-map", headers=MARCUS).json()
    wm = mock("authority-map.json")
    assert amap["capabilities"] == wm["capabilities"] and amap["legend"] == wm["legend"]
    cells = {i["username"]: i["cells"] for i in amap["identities"]}
    assert cells["ai-oncall-agent"]["customer_pii.selfdecrypt"] == "pending"
    assert cells["marcus.lee"]["customer_pii.selfdecrypt"] == "allowed"
    assert cells["dave.kim"]["customer_pii.selfdecrypt"] == "pending"
    assert all(c["roles.grant"] == "locked" and c["audit.write"] == "locked" for c in cells.values())
    assert client.get(f"{API}/governance/overview", headers=LINH).status_code == 403


def test_agents_registry_and_detail(client):
    items = client.get(f"{API}/agents", headers=MARCUS).json()["items"]
    assert [a["username"] for a in items] == ["ai-oncall-agent", "ledger-bot", "docs-agent"]
    assert items[0]["status"] == "waiting_approval" and items[0]["flags"] == ["pending_request"]
    d = client.get(f"{API}/agents/ai-oncall-agent", headers=LINH).json()
    assert set(mock("agent-detail.json")) <= set(d)
    assert [r["id"] for r in d["requests"]] == ["CR-0192", "CR-0193"]
    assert d["runs"][0]["id"] == "run_01"
    assert client.get(f"{API}/agents/ledger-bot", headers=LINH).status_code == 200
    assert client.get(f"{API}/agents/nobody", headers=LINH).status_code == 404


def test_revoke_all_is_instant_and_needs_no_quorum(client):
    approve_192(client)
    gov = client.app.state.governance
    assert ROLE in gov.user_roles("ai-oncall-agent")
    assert client.post(f"{API}/agents/ai-oncall-agent/revoke-all", headers=LINH).status_code == 403
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"v": 1, "type": "auth", "payload": {"demo_user": "ai-oncall-agent"}})
        assert ws.receive_json()["type"] == "auth_ok"
        r = client.post(f"{API}/agents/ai-oncall-agent/revoke-all", headers=MARCUS)
        assert r.status_code == 200
        body = r.json()
        assert set(body) == set(mock("agent-revoke-all.json"))
        assert body["revoked"] == [ROLE] and body["quorum_required"] is False
        assert body["withdrawn_requests"] == ["CR-0193"] and body["run_paused"] == "run_01"
        msg = ws.receive_json()
        while msg["type"] != "authority.updated":
            msg = ws.receive_json()
        assert msg["payload"]["changed"]["state"] == "locked" and msg["payload"]["token_refresh_required"] is True
    assert ROLE not in gov.user_roles("ai-oncall-agent")
    assert ROLE not in client.get(f"{API}/me", headers=AGENT).json()["roles"]
    assert client.get(f"{API}/requests/CR-0192", headers=LINH).json()["status"] == "revoked"
    assert client.get(f"{API}/requests/CR-0193", headers=LINH).json()["status"] == "withdrawn"
    assert client.get(f"{API}/agents/ai-oncall-agent", headers=LINH).json()["runs"][0]["status"] == "paused"
    last = client.get(f"{API}/audit?limit=200", headers=PRIYA).json()["items"][-1]
    assert last["action"] == "agent.revoke_all" and last["outcome"] == "revoked"


def test_admin_users_and_merchants(client):
    users = client.get(f"{API}/admin/users", headers=DAVE).json()["items"]
    assert [u["username"] for u in users][:2] == ["ai-oncall-agent", "linh.tran"]
    assert set(users[0]) == set(mock("admin-users.json")["items"][0])
    assert users[0]["pending_requests"] == ["CR-0192", "CR-0193", "CR-0195"]
    assert next(u for u in users if u["username"] == "dave.kim")["pending_requests"] == ["CR-0194"]

    empty = client.get(f"{API}/admin/data/merchants", headers=DAVE).json()
    assert empty["items"][0]["name"].startswith("MOCK-CIPHERTEXT") and empty["total"] == 48201
    cipher = "A1b2C3d4E5f6G7h8I9j0K1l2"
    r = client.put(f"{API}/records/mrc_1", headers=MARCUS, json={"tag": "customer_pii", "ciphertext": cipher})
    assert r.status_code == 200
    got = client.get(f"{API}/admin/data/merchants?limit=3", headers=DAVE).json()
    assert got["total"] == 1 and got["items"][0] == {"id": "mrc_1", "name": cipher, "bank_account": cipher,
                                                      "tax_id": cipher, "encrypted": True}
    assert client.get(f"{API}/admin/data/merchants", headers=LINH).status_code == 403


def test_export_is_ciphertext_only_and_audited(client):
    r = client.post(f"{API}/admin/data/merchants/export", headers=DAVE)
    body = r.json()
    assert r.status_code == 200 and set(body) == set(mock("admin-export.json"))
    assert body["format"] == "ciphertext" and "Keys are not held" in body["note"]
    ev = client.get(f"{API}/audit/{body['audit_event_id']}", headers=PRIYA).json()
    assert ev["action"] == "admin.data.export" and ev["actor"] == "dave.kim"
    assert client.post(f"{API}/admin/data/merchants/export", headers=MARCUS).status_code == 403


def test_audit_delete_creates_t3_request_and_audits(client):
    ev = append_audit(client.app.state.db, actor="ai-oncall-agent", actor_type="agent", action="grant_role",
                      target="ai-oncall-agent:realm-admin", outcome="blocked", incident_id="INC-2417")
    r = client.delete(f"{API}/admin/audit/{ev['id']}", headers=DAVE)
    err = r.json()["error"]
    assert r.status_code == 403 and err["code"] == "tide_refused"
    assert set(err["details"]) == set(mock("admin-audit-delete.json")["error"]["details"])
    assert err["details"]["tier"] == "T3" and err["details"]["required"] == 3
    req = client.get(f"{API}/requests/{err['details']['request_id']}", headers=LINH).json()
    assert req["type"] == "audit_delete" and req["tier"] == "T3" and "self_grant" not in req["flags"]
    logged = client.get(f"{API}/audit/{err['details']['recorded_as']}", headers=PRIYA).json()
    assert logged["action"] == "admin.audit.delete" and logged["outcome"] == "blocked"
    assert client.get(f"{API}/audit/{ev['id']}", headers=PRIYA).json()["verified"] is True
    assert client.delete(f"{API}/admin/audit/ae_9999", headers=DAVE).status_code == 404
    assert client.delete(f"{API}/admin/audit/{ev['id']}", headers=LINH).status_code == 403


def test_audit_list_filters_cursor_and_verify(client):
    approve_192(client)
    client.post(f"{API}/requests", headers=AGENT, json={
        "type": "grant_role", "capability": "roles.grant", "roles": ["realm-admin"],
        "justification": "injected", "incident_id": "INC-2417"})
    full = client.get(f"{API}/audit", headers=PRIYA).json()
    assert set(full) == set(mock("audit.json")) and full["total"] == len(full["items"]) >= 3
    assert full["chain"] == [e["id"] for e in full["items"]] and all(e["verified"] for e in full["items"])
    assert set(full["items"][0]) == set(mock("audit-event.json"))
    blocked = client.get(f"{API}/audit?outcome=blocked&actor_type=agent", headers=PRIYA).json()
    assert blocked["total"] == 1 and blocked["filters"] == {"outcome": "blocked", "actor_type": "agent"}
    by_cap = client.get(f"{API}/audit?capability=customer_pii.selfdecrypt", headers=PRIYA).json()
    assert by_cap["total"] >= 2 and all(e["request_id"] == "CR-0192" for e in by_cap["items"])
    assert client.get(f"{API}/audit?incident=INC-2417", headers=LINH).json()["total"] == full["total"]
    page1 = client.get(f"{API}/audit?limit=2", headers=PRIYA).json()
    page2 = client.get(f"{API}/audit?limit=2&cursor={page1['next_cursor']}", headers=PRIYA).json()
    assert len(page1["items"]) == 2 and page2["items"][0]["id"] == full["items"][2]["id"]
    assert client.get(f"{API}/audit", headers=AGENT).status_code == 403
    assert client.get(f"{API}/audit/ae_9999", headers=PRIYA).status_code == 404

    ok = client.post(f"{API}/audit/{full['items'][1]['id']}/verify", headers=PRIYA).json()
    assert set(mock("audit-verify.json")) <= set(ok) and ok["verified"] is True


def test_audit_verify_detects_tampering(client):
    approve_192(client)
    client.post(f"{API}/requests", headers=AGENT, json={
        "type": "grant_role", "capability": "roles.grant", "roles": ["realm-admin"], "justification": "x"})
    items = client.get(f"{API}/audit", headers=PRIYA).json()["items"]
    target, nxt = items[1]["id"], items[2]["id"]
    db = client.app.state.db
    db.execute("UPDATE audit_events SET hash = ? WHERE id = ?", ("sha256:" + "0" * 64, target))
    db.commit()
    bad = client.post(f"{API}/audit/{target}/verify", headers=PRIYA).json()
    assert bad["verified"] is False and "hash" in bad["reason"]
    assert client.post(f"{API}/audit/{nxt}/verify", headers=PRIYA).json()["verified"] is False
    assert client.post(f"{API}/audit/{items[0]['id']}/verify", headers=PRIYA).json()["verified"] is True
    assert client.get(f"{API}/audit/{target}", headers=PRIYA).json()["verified"] is False
    db.execute("UPDATE audit_events SET outcome = 'allowed' WHERE id = ?", (items[0]["id"],))
    db.commit()
    assert client.post(f"{API}/audit/{items[0]['id']}/verify", headers=PRIYA).json()["verified"] is False


def test_incident_access_lists_requests(client):
    body = client.get(f"{API}/incidents/INC-2417/access", headers=LINH).json()
    want = mock("incident-access.json")
    assert body["incident_id"] == "INC-2417" and set(body["items"][0]) == set(want["items"][0])
    assert [i["id"] for i in body["items"]] == ["CR-0192", "CR-0193", "CR-0194", "CR-0195"]
    assert client.get(f"{API}/incidents/INC-0000/access", headers=LINH).status_code == 404


def test_receipt_after_approve_flow(client):
    client.post(f"{API}/requests", headers=AGENT, json={
        "type": "grant_role", "capability": "roles.grant", "roles": ["realm-admin"],
        "justification": "injected", "incident_id": "INC-2417", "run_id": "run_01"})
    approve_192(client)
    ids = ["mrc_8812", "mrc_8830"]
    assert client.post(f"{API}/records/access-log", headers=AGENT, json={
        "run_id": "run_01", "record_ids": ids, "fields": ["name", "last_tx"]}).status_code == 204
    assert client.post(f"{API}/demo/requests/CR-0192/expire", headers=LINH).status_code == 200

    rc = client.get(f"{API}/incidents/INC-2417/receipt", headers=PRIYA).json()
    want = mock("receipt.json")
    assert set(rc) == set(want) and set(rc["summary"]) == set(want["summary"])
    assert rc["title"] == "Access Receipt · INC-2417"
    assert rc["summary"]["who"] == ["ai-oncall-agent (Atlas)"]
    assert rc["summary"]["what"] == "customer_pii.selfdecrypt · 2 records"
    assert [(a["request_id"], a["approver"]) for a in rc["approvals"]] == [("CR-0192", "linh.tran"),
                                                                          ("CR-0192", "marcus.lee")]
    assert set(rc["approvals"][0]) == set(want["approvals"][0])
    da = rc["data_accessed"]
    assert da["record_ids"] == ids and da["fields"] == ["name", "last_tx"] and da["granted_min"] == 15
    assert da["actual_use"].endswith("s") and "m" in da["actual_use"]
    assert len(rc["blocked_attempts"]) == 1 and rc["blocked_attempts"][0]["actor"] == "ai-oncall-agent"
    assert rc["blocked_attempts"][0]["what"].startswith("grant realm-admin")
    assert rc["blocked_attempts"][0]["tier"] == "T3"
    assert {s["event"].split()[0] for s in rc["signatures"]} == {"request.approved", "data.accessed",
                                                                 "request.expired"}
    assert client.get(f"{API}/incidents/INC-2417/receipt", headers=DAVE).status_code == 403
    assert client.get(f"{API}/incidents/INC-0000/receipt", headers=PRIYA).status_code == 404


def test_policy_versions_and_draft(client):
    v = client.get(f"{API}/policies/versions", headers=PRIYA).json()["items"]
    assert [x["version"] for x in v] == ["v7", "v6", "v5"]
    assert v == mock("policy-versions.json")["items"]
    assert client.get(f"{API}/policies/versions", headers=LINH).status_code == 403
    draft = {"version": "v8", "tiers": {}}
    assert client.post(f"{API}/policies/draft", headers=LINH, json=draft).status_code == 403
    r = client.post(f"{API}/policies/draft", headers=MARCUS, json=draft)
    body = r.json()
    assert r.status_code == 202 and body["code"] == "quorum_required"
    assert body["request"]["type"] == "policy_change" and body["request"]["tier"] == "T3"
    assert body["request"]["capability"] == "policy.edit" and body["request"]["status"] == "pending"
    assert client.get(f"{API}/policies", headers=LINH).json()["version"] == "v7"
    assert client.post(f"{API}/policies/draft", headers=MARCUS, json={}).status_code == 422
