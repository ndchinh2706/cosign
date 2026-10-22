"""Demo seed (storyboard CR-0192..0195, policy v7) taken from docs/mocks so the flow runs in AUTH_MODE=dev."""
import json
import sqlite3
from pathlib import Path

from .policy import Policy

RESET_TABLES = ["approvals", "access_requests", "notifications", "audit_events", "role_grants", "policy_versions"]


def _load(mocks: Path, name: str):
    return json.loads((mocks / name).read_text(encoding="utf-8"))


def _seed_base(db: sqlite3.Connection, mocks: Path) -> None:
    inc = _load(mocks, "incident.json")
    db.execute(
        "INSERT OR IGNORE INTO incidents (id, title, service, severity, status, started_at, resolved_at, owner_agent,"
        " owner_human, error_rate) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (inc["id"], inc["title"], inc["service"], inc["severity"], inc["status"], inc["started_at"],
         inc["resolved_at"], inc["owner_agent"], inc["owner_human"], inc["error_rate"]))
    run = _load(mocks, "agent-run.json")
    db.execute(
        "INSERT OR IGNORE INTO agent_runs (id, incident_id, agent, status, started_at, finished_at, context_flagged,"
        " context_quarantined) VALUES (?,?,?,?,?,?,?,?)",
        (run["id"], run["incident_id"], run["agent"], run["status"], run["started_at"], run["finished_at"],
         int(run["context_flagged"]), int(run["context_quarantined"])))


def seed_records(db: sqlite3.Connection, mocks: Path) -> None:
    """Load the sample ciphertexts (docs/mocks/records.json) only when merchant_records is empty."""
    if db.execute("SELECT 1 FROM merchant_records LIMIT 1").fetchone():
        return
    for r in _load(mocks, "records.json")["items"]:
        db.execute("INSERT OR IGNORE INTO merchant_records (id, tag, ciphertext, encrypted_by, encrypted_at)"
                   " VALUES (?,?,?,?,?)", (r["id"], r["tag"], r["ciphertext"], r["encrypted_by"], r["encrypted_at"]))
    db.commit()


def seed(db: sqlite3.Connection, mocks: Path, gov, records: bool = True) -> None:
    """Idempotent: only fills an empty policy/request set."""
    if records:
        seed_records(db, mocks)
    if db.execute("SELECT 1 FROM policy_versions LIMIT 1").fetchone():
        return
    _seed_base(db, mocks)
    policy = _load(mocks, "policies.json")
    history = {v["version"]: v for v in _load(mocks, "policy-versions.json")["items"]}
    db.execute("INSERT INTO policy_versions (version, body_json, signed_by_json, hash, created_at, signature, change)"
               " VALUES (?,?,?,?,?,?,?)",
               (policy["version"], json.dumps(policy), json.dumps(policy.get("signed_by", [])),
                policy.get("hash"), policy.get("created_at"), policy.get("signature"),
                history.get(policy["version"], {}).get("change")))
    for v in history.values():
        if v["version"] != policy["version"]:
            db.execute("INSERT INTO policy_versions (version, body_json, signed_by_json, hash, created_at, signature,"
                       " change) VALUES (?,NULL,?,?,?,?,?)",
                       (v["version"], json.dumps([{"username": u} for u in v["signed_by"]]), v["hash"],
                        v["created_at"], v["signature"], v["change"]))
    pol = Policy(policy)
    for r in _load(mocks, "requests.json")["items"]:
        spec = pol.tier_spec(r["tier"])
        tide_cr = gov.propose_role_change(r["target_user"], r["roles"], [], r["justification"],
                                          {"required": r["quorum"]["required"], "request_id": r["id"]})
        db.execute(
            "INSERT INTO access_requests (id, type, run_id, incident_id, requester, requester_type, target_user,"
            " capability, roles_json, scope_json, duration_min, justification, evidence_json, base_tier, tier,"
            " escalated, escalation_reason, required, eligible_json, status, flags_json, tide_cr_id, created_at,"
            " safety_checks_json, security_context_json, decision_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["type"], r["run_id"], r["incident_id"], r["requester"]["username"], r["requester"]["type"],
             r["target_user"], r["capability"], json.dumps(r["roles"]), json.dumps(r["scope"]), r["duration_min"],
             r["justification"], json.dumps(r["evidence"]), r["base_tier"], r["tier"], int(r["escalated"]),
             r["escalation_reason"], r["quorum"]["required"], json.dumps(spec["eligible"]), "pending",
             json.dumps(r["flags"]), tide_cr, r["created_at"], json.dumps(r["safety_checks"]),
             json.dumps(r["security_context"]) if r["security_context"] else None,
             json.dumps({"flag_note": r["flag_note"]}) if r.get("flag_note") else None))
    for user, suffix in (("linh.tran", ""), ("marcus.lee", "_m")):
        for g in _load(mocks, "notifications.json")["groups"]:
            for n in g["items"]:
                meta = {"run_id": n["run_id"]} if n.get("request_id") is None and n.get("run_id") else {}
                db.execute(
                    "INSERT INTO notifications (id, user, group_name, title, body, request_id, read, ts, meta_json)"
                    " VALUES (?,?,?,?,?,?,0,?,?)",
                    (n["id"] + suffix, user, n["group"], n["title"], n["body"], n["request_id"], n["ts"],
                     json.dumps(meta)))
    db.commit()


def rehydrate(db: sqlite3.Connection, gov) -> None:
    """Re-register pending change requests with the (in-memory) governance mock after a restart."""
    for r in db.execute("SELECT * FROM access_requests WHERE status = 'pending'"):
        approvers = [a["approver"] for a in db.execute(
            "SELECT approver FROM approvals WHERE request_id = ? AND decision = 'approve'", (r["id"],))]
        gov.propose_role_change(r["target_user"], json.loads(r["roles_json"] or "[]"), [], r["justification"],
                                {"required": r["required"], "request_id": r["id"], "approvers": approvers})


def reset(db: sqlite3.Connection, mocks: Path, gov, seed_roles: dict, records: bool = True) -> None:
    for t in RESET_TABLES:
        db.execute(f"DELETE FROM {t}")
    db.commit()
    gov.reset(seed_roles)
    seed(db, mocks, gov, records)
