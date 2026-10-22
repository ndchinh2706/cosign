import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

API = "/api/v1"
AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}
MARCUS = {"X-Demo-User": "marcus.lee"}
DAVE = {"X-Demo-User": "dave.kim"}
IDS = ["mrc_8812", "mrc_8830", "mrc_8841", "mrc_8857", "mrc_8863"]
SECRET = "Saigon Brew Co."
RECORDS = [{"id": i, "name": SECRET, "settlement_bank": "Vietcombank ****4021", "payout_currency": "VND",
            "payout_currency_prev": "EUR"} for i in IDS]


def make_client(tmp_path, **kw):
    s = Settings(_env_file=None, auth_mode="dev", agent_mode="scripted", db_path=str(tmp_path / "t.db"),
                 ws_auth_timeout_s=0.5, signing_tick_s=0, expiry_sweep_s=3600, **{"agent_step_delay_s": 0, **kw})
    return TestClient(create_app(s))


@pytest.fixture
def ac(tmp_path):
    with make_client(tmp_path) as c:
        yield c


def drain(ws, until, pred=lambda m: True, limit=300):
    seen = []
    for _ in range(limit):
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == until and pred(msg):
            return msg, seen
    raise AssertionError(f"no {until} in {[m['type'] for m in seen]}")


def console(ws):
    ws.send_json({"v": 1, "type": "auth", "payload": {"demo_user": "ai-oncall-agent"}})
    assert ws.receive_json()["type"] == "auth_ok"
    ws.send_json({"v": 1, "type": "subscribe", "payload": {"channels": ["incident:INC-2417"], "console": True}})
    ws.send_json({"v": 1, "type": "ping", "payload": {}})
    drain(ws, "pong")


def tool_result(ws, call, ok, **kw):
    ws.send_json({"v": 1, "type": "tool_result", "payload": {"call_id": call["payload"]["call_id"],
                  "run_id": call["payload"]["run_id"], "tool": "decrypt_records", "ok": ok, **kw}})


def start(client):
    r = client.post(f"{API}/agent/runs", headers=AGENT, json={"incident_id": "INC-2417"})
    assert r.status_code == 201, r.text
    return r.json()


def get_run(c, rid):
    return c.get(f"{API}/agent/runs/{rid}", headers=LINH).json()


def test_scripted_full_flow(ac):
    with ac.websocket_connect("/ws") as ws:
        console(ws)
        run = start(ac)
        rid = run["id"]
        assert run["mode"] == "scripted" and run["ws_channel"] == f"run:{rid}"

        call, seen = drain(ws, "tool_call")
        assert call["channel"] == "agent-console:ai-oncall-agent"
        assert call["payload"]["input"] == {"ids": IDS, "tag": "customer_pii"}
        tools = [m["payload"]["tool_name"] for m in seen if m["type"] == "agent.step" and m["payload"]["kind"] == "tool"]
        assert tools[:3] == ["get_metrics", "read_logs", "rollback"]
        assert ac.get(f"{API}/incidents/INC-2417", headers=LINH).json()["error_rate"] == 0.04

        tool_result(ws, call, False, error={"code": "tide_refused", "missing_role": "_tide_customer_pii.selfdecrypt"})
        created, _ = drain(ws, "request.created")
        t2 = created["payload"]
        assert t2["tier"] == "T2" and t2["run_id"] == rid and t2["requester"]["username"] == "ai-oncall-agent"

        wait, _ = drain(ws, "agent.run.status", lambda m: m["payload"]["status"] == "waiting_approval")
        assert wait["payload"]["reason"] == t2["id"]

        blocked, _ = drain(ws, "agent.step", lambda m: m["payload"]["status"] == "blocked")
        b = blocked["payload"]
        assert b["tool_name"] == "grant_role" and b["tier"] == "T3" and b["escalated"] is True
        t3 = ac.get(f"{API}/requests/{b['output']['request_id']}", headers=AGENT).json()
        assert t3["tier"] == "T3" and t3["status"] == "pending" and "injection" in t3["flags"]
        assert get_run(ac, rid)["context_flagged"] is True

        assert ac.post(f"{API}/requests/{t2['id']}/approve", headers=LINH).json()["quorum"]["approvals"] == 1
        assert ac.post(f"{API}/requests/{t2['id']}/approve", headers=MARCUS).json()["status"] == "approved"

        call2, _ = drain(ws, "tool_call")
        assert call2["payload"]["call_id"] != call["payload"]["call_id"]
        tool_result(ws, call2, True, output={"records": RECORDS, "fields": ["name", "settlement_bank"]})
        drain(ws, "agent.run.status", lambda m: m["payload"]["status"] == "completed")

    got = get_run(ac, rid)
    assert got["status"] == "completed" and got["finished_at"]
    names = [s.get("tool_name") for s in got["steps"] if s["kind"] == "tool"]
    assert names == ["get_metrics", "read_logs", "rollback", "decrypt_records", "request_access", "read_logs",
                     "grant_role", "decrypt_records", "request_access"]
    ok_decrypt = [s for s in got["steps"] if s.get("tool_name") == "decrypt_records" and s["status"] == "ok"][0]
    assert ok_decrypt["output"]["records"] == 5
    hotfix = got["steps"][-1]
    assert hotfix["input"]["capability"] == "deploy.hotfix" and hotfix["status"] == "pending"
    assert "EUR→VND" in [s for s in got["steps"] if s["kind"] == "message"][-1]["text"]

    summary = ac.get(f"{API}/agent/runs/{rid}/summary", headers=LINH).json()
    assert summary["actions"]["blocked"] == 1 and summary["actions"]["approved"] == 1
    assert ac.get(f"{API}/agent/runs?incident=INC-2417", headers=LINH).json()["items"][0]["id"] == rid

    dump = "\n".join(ac.app.state.db.iterdump())
    assert SECRET not in dump and "Vietcombank" not in dump


def test_tool_result_rest_fallback(ac):
    with ac.websocket_connect("/ws") as ws:
        console(ws)
        rid = start(ac)["id"]
        call, _ = drain(ws, "tool_call")
        body = {"call_id": call["payload"]["call_id"], "tool": "decrypt_records", "ok": False,
                "error": {"code": "tide_refused"}}
        assert ac.post(f"{API}/agent/runs/{rid}/tool-result", headers=LINH, json=body).status_code == 403
        assert ac.post(f"{API}/agent/runs/{rid}/tool-result", headers=AGENT, json=body).json() == {"accepted": True}
        drain(ws, "request.created")
        assert ac.post(f"{API}/agent/runs/{rid}/tool-result", headers=AGENT, json=body).status_code == 404


def test_console_offline_fails_run(tmp_path):
    with make_client(tmp_path, agent_tool_timeout_s=0.2) as c:
        rid = start(c)["id"]
        run = {}
        for _ in range(100):
            run = get_run(c, rid)
            if run["status"] == "failed":
                break
            time.sleep(0.05)
        assert run["status"] == "failed"
        last = [s for s in run["steps"] if s["kind"] == "tool"][-1]
        assert last["status"] == "error" and last["error"]["code"] == "console_offline"


def test_pause_resume_quarantine(tmp_path):
    with make_client(tmp_path, agent_tool_timeout_s=5, agent_step_delay_s=0.1) as c:
        rid = start(c)["id"]
        assert c.post(f"{API}/agent/runs/{rid}/pause", headers=AGENT).status_code == 403
        assert c.post(f"{API}/agent/runs/{rid}/pause", headers=LINH).json() == {"run_id": rid, "status": "paused"}
        time.sleep(0.3)
        n = len(get_run(c, rid)["steps"])
        time.sleep(0.5)
        paused = get_run(c, rid)
        assert paused["status"] == "paused" and len(paused["steps"]) == n

        assert c.post(f"{API}/agent/runs/{rid}/resume", headers=LINH).json()["status"] == "running"
        run = {}
        for _ in range(100):
            run = get_run(c, rid)
            if len(run["steps"]) > n:
                break
            time.sleep(0.05)
        assert run["status"] == "running" and len(run["steps"]) > n

        assert c.post(f"{API}/agent/runs/{rid}/quarantine", headers=LINH).status_code == 403
        q = c.post(f"{API}/agent/runs/{rid}/quarantine", headers=MARCUS).json()
        assert q == {"run_id": rid, "context_quarantined": True}
        assert get_run(c, rid)["context_quarantined"] is True


def test_run_rules(ac):
    assert ac.post(f"{API}/agent/runs", headers=DAVE, json={"incident_id": "INC-2417"}).status_code == 403
    assert ac.post(f"{API}/agent/runs", headers=AGENT, json={"incident_id": "INC-0"}).status_code == 404
    assert ac.post(f"{API}/agent/runs", headers=AGENT, json={"incident_id": "INC-2417", "mode": "x"}).status_code == 422
    start(ac)
    assert ac.post(f"{API}/agent/runs", headers=AGENT, json={"incident_id": "INC-2417"}).status_code == 409
    assert get_run(ac, "run_01")["steps"][0]["id"] == "st_01"
    assert ac.get(f"{API}/agent/runs/nope", headers=LINH).status_code == 404
    assert ac.post(f"{API}/agent/runs/run_01/pause", headers=LINH).status_code == 409


def test_llm_without_key_falls_back(tmp_path):
    s = Settings(_env_file=None, auth_mode="dev", agent_mode="llm", anthropic_api_key="",
                 db_path=str(tmp_path / "t.db"), agent_step_delay_s=0, expiry_sweep_s=3600)
    with TestClient(create_app(s)) as c:
        assert start(c)["mode"] == "scripted"
