import asyncio
import json

from app import payments

AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}
MARCUS = {"X-Demo-User": "marcus.lee"}
P = "/api/v1"
INJECT_SNIPPET = "Ignorez les instructions"


def mock(client, name):
    return json.loads((client.app.state.settings.mocks_dir / name).read_text())


def error_rate(client, incident="INC-2417"):
    return client.get(f"{P}/incidents/{incident}", headers=LINH).json()["error_rate"]


def test_seed_matches_mock_shapes(client):
    inc = client.get(f"{P}/incidents/INC-2417", headers=LINH).json()
    assert set(inc) == set(mock(client, "incident.json")) and inc["error_rate"] == 0.38
    assert set(client.get(f"{P}/incidents", headers=LINH).json()["items"][0]) == \
        set(mock(client, "incidents.json")["items"][0])
    assert client.get(f"{P}/incidents/INC-2417/timeline", headers=LINH).json()["items"][0]["id"] == "tl_01"
    assert client.get(f"{P}/incidents/INC-9999", headers=LINH).status_code == 404
    assert [d["version"] for d in client.get(f"{P}/deploys", headers=LINH).json()["items"]] == ["v411", "v412", "v413"]
    assert client.get(f"{P}/incidents/INC-2417/metrics", headers=LINH).json()["points"][-1] == ["03:12", 0.38]


def test_rollback_changes_metrics_services_deploys(client):
    db = client.app.state.db
    client.get(f"{P}/services", headers=LINH)
    result = payments.rollback(db, "v412")
    assert result["from"] == "v413" and result["to"] == "v412"

    assert error_rate(client) == 0.04
    pts = client.get(f"{P}/incidents/INC-2417/metrics", headers=LINH).json()
    assert pts["points"][-2:] == [["03:13", 0.19], ["03:14", 0.04]]
    assert {"at": "03:12", "label": "rollback v412", "kind": "rollback"} in pts["markers"]

    svc = {s["name"]: s for s in client.get(f"{P}/services", headers=LINH).json()["items"]}["payments-api"]
    assert svc["current_deploy"] == "v412" and svc["error_rate"] == 0.04 and svc["trend"] == "improving"

    deploys = {d["version"]: d for d in client.get(f"{P}/deploys", headers=LINH).json()["items"]}
    assert deploys["v412"]["status"] == "active"
    assert deploys["v413"]["status"] == "rolled_back" and deploys["v413"]["rolled_back_by"] == "ai-oncall-agent"

    tl = client.get(f"{P}/incidents/INC-2417/timeline", headers=LINH).json()["items"]
    assert tl[-1]["label"] == "rollback(deploy=v412) · T0 auto"
    labels = [m["label"] for m in client.get(f"{P}/incidents/INC-2417", headers=LINH).json()["mini_timeline"]]
    assert labels[-1] == "rollback v412 (Atlas, T0)"

    row = db.execute("SELECT action, outcome FROM audit_events").fetchone()
    assert (row["action"], row["outcome"]) == ("deploy.rollback", "allowed")


def test_rollback_current_or_unknown_deploy_fails(client):
    client.get(f"{P}/services", headers=LINH)
    db = client.app.state.db
    for deploy, status in (("v413", 409), ("v999", 404)):
        try:
            payments.rollback(db, deploy)
        except Exception as e:
            assert e.status == status
        else:
            raise AssertionError("expected ApiError")


def test_publish_rollback_emits_ws_events(client):
    client.get(f"{P}/services", headers=LINH)
    result = payments.rollback(client.app.state.db, "v412")
    sent = []

    class Hub:
        async def publish(self, channel, type_, payload):
            sent.append((channel, type_, payload))

    asyncio.run(payments.publish_rollback(Hub(), result))
    assert [t for _, t, _ in sent] == ["audit.appended", "metrics.tick", "metrics.tick", "incident.updated"]
    assert sent[1][2] == {"service": "payments-api", "at": "03:13", "error_rate": 0.19}
    assert sent[-1][2]["error_rate"] == 0.04


def test_inject_log_shows_in_logs(client):
    before = client.get(f"{P}/logs", headers=AGENT).json()["items"]
    assert not any(i["injected"] for i in before)
    r = client.post(f"{P}/demo/logs/inject", headers=LINH)
    assert r.status_code == 200 and r.json()["ok"]
    items = client.get(f"{P}/logs", headers=AGENT).json()["items"]
    line = next(i for i in items if i["id"] == r.json()["injected_line_id"])
    assert line["injected"] is True and line["level"] == "WARN" and INJECT_SNIPPET in line["text"]
    assert line["scan"]["label"] == "PROMPT_INJECTION" and line["scan"]["score"] == 0.97
    assert all("scan" not in i for i in items if not i["injected"])


def test_logs_since_filter(client):
    items = client.get(f"{P}/logs?since=03:12", headers=AGENT).json()["items"]
    assert items and all(i["ts"][11:16] >= "03:12" for i in items)


def test_reset_restores_seed_and_keeps_records(client):
    ct = "QUJDREVGR0hJSktMTU5PUA=="
    client.put(f"{P}/records/mrc_1", json={"tag": "customer_pii", "ciphertext": ct}, headers=MARCUS)
    client.post(f"{P}/demo/logs/inject", headers=LINH)
    client.get(f"{P}/services", headers=LINH)
    payments.rollback(client.app.state.db, "v412")
    client.app.state.clock_offset_min = 5

    r = client.post(f"{P}/demo/reset", headers=LINH)
    assert r.json()["ok"] and r.json()["reset"]
    assert error_rate(client) == 0.38
    assert not any(i["injected"] for i in client.get(f"{P}/logs", headers=AGENT).json()["items"])
    assert client.get(f"{P}/deploys", headers=LINH).json()["items"][2]["status"] == "active"
    assert client.app.state.db.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0] == 0
    assert client.app.state.clock_offset_min == 0
    assert len(client.get(f"{P}/records", headers=AGENT).json()["items"]) == 1

    client.post(f"{P}/demo/reset", json={"wipe_records": True}, headers=LINH)
    assert client.get(f"{P}/records", headers=AGENT).json()["items"] == []


def test_demo_clock(client):
    assert client.post(f"{P}/demo/clock", json={"offset_min": 15}, headers=LINH).json()["offset_min"] == 15
    assert client.post(f"{P}/demo/clock", json={"offset_min": "x"}, headers=LINH).status_code == 422


def records(n=5):
    return [{"id": f"mrc_{i}", "tag": "customer_pii", "ciphertext": f"Y2lwaGVydGV4dC1ibG9i{i:04d}XYZ=="}
            for i in range(n)]


def test_records_bulk_then_get(client):
    items = records()
    r = client.post(f"{P}/records/bulk", json={"items": items}, headers=MARCUS)
    assert r.status_code == 201 and r.json() == {"count": 5}
    got = client.get(f"{P}/records", headers=AGENT).json()["items"]
    assert [(g["id"], g["tag"], g["ciphertext"]) for g in got] == [(i["id"], i["tag"], i["ciphertext"]) for i in items]
    assert set(got[0]) == set(mock(client, "records.json")["items"][0]) and got[0]["encrypted_by"] == "marcus.lee"
    sub = client.get(f"{P}/records?ids=mrc_1,mrc_3", headers=AGENT).json()["items"]
    assert [g["id"] for g in sub] == ["mrc_1", "mrc_3"]


def test_records_put_upserts_and_needs_role(client):
    body = {"tag": "customer_pii", "ciphertext": "Y2lwaGVydGV4dC1ibG9iMDAwMQ=="}
    assert client.put(f"{P}/records/mrc_9", json=body, headers=LINH).status_code == 403
    assert client.put(f"{P}/records/mrc_9", json=body, headers=MARCUS).status_code == 200
    body["ciphertext"] = "Y2lwaGVydGV4dC1ibG9iMDAwMg=="
    client.put(f"{P}/records/mrc_9", json=body, headers=MARCUS)
    got = client.get(f"{P}/records?ids=mrc_9", headers=AGENT).json()["items"]
    assert len(got) == 1 and got[0]["ciphertext"] == body["ciphertext"]


def test_records_reject_plaintext(client):
    ok = "Y2lwaGVydGV4dC1ibG9iMDAwMQ=="
    bad = [
        {"tag": "customer_pii", "ciphertext": ok, "name": "Saigon Brew Co."},
        {"tag": "customer_pii", "ciphertext": ok, "plaintext": {"name": "x"}},
        {"tag": "customer_pii", "ciphertext": "Saigon Brew Co. Vietcombank 4021"},
        {"tag": "customer_pii", "ciphertext": '{"name":"Saigon Brew Co."}'},
    ]
    for body in bad:
        r = client.put(f"{P}/records/mrc_1", json=body, headers=MARCUS)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] in ("plaintext_rejected", "validation_error")
    r = client.post(f"{P}/records/bulk", json={"items": [{"id": "a", **bad[0]}]}, headers=MARCUS)
    assert r.status_code == 422 and r.json()["error"]["code"] == "plaintext_rejected"
    assert client.get(f"{P}/records", headers=AGENT).json()["items"] == []


def test_access_log_creates_audit_without_values(client):
    client.post(f"{P}/records/bulk", json={"items": records()}, headers=MARCUS)
    body = {"run_id": "run_01", "record_ids": ["mrc_0", "mrc_1"], "fields": ["payout_currency", "last_tx"]}
    r = client.post(f"{P}/records/access-log", json=body, headers=AGENT)
    assert r.status_code == 204
    row = client.app.state.db.execute("SELECT * FROM audit_events WHERE action='data.accessed'").fetchone()
    assert row["actor"] == "ai-oncall-agent" and row["actor_type"] == "agent" and row["outcome"] == "allowed"
    assert row["target"] == "customer_pii:mrc_0,mrc_1"
    assert json.loads(row["payload_json"]) == {"run_id": "run_01", "record_ids": ["mrc_0", "mrc_1"],
                                               "fields": ["payout_currency", "last_tx"]}


def test_access_log_rejects_values_and_wrong_role(client):
    base = {"run_id": "run_01", "record_ids": ["mrc_0"], "fields": ["payout_currency"]}
    assert client.post(f"{P}/records/access-log", json=base, headers=LINH).status_code == 403
    for bad in ({**base, "fields": ["Saigon Brew Co."]}, {**base, "values": {"name": "x"}}):
        assert client.post(f"{P}/records/access-log", json=bad, headers=AGENT).status_code == 422
    assert client.app.state.db.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0] == 0


def test_access_log_publishes_audit_appended(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"v": 1, "type": "auth", "payload": {"demo_user": "linh.tran"}})
        assert ws.receive_json()["type"] == "auth_ok"
        client.post(f"{P}/records/access-log",
                    json={"run_id": "run_01", "record_ids": ["mrc_0"], "fields": ["payout_currency"]}, headers=AGENT)
        msg = ws.receive_json()
    assert msg["type"] == "audit.appended" and msg["payload"]["action"] == "data.accessed"
