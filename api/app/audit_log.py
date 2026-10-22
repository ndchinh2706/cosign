"""Hash-chained audit append. Shape: docs/API.md §5.9 / docs/mocks/audit-event.json."""
import hashlib
import json
from datetime import datetime

from .ws import TZ


def _hash(body: dict, prev_hash: str) -> str:
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256((prev_hash + raw).encode()).hexdigest()


def append_audit(conn, *, actor: str, actor_type: str, action: str, target: str, outcome: str,
                 incident_id: str | None = None, request_id: str | None = None,
                 payload: dict | None = None, signers: list[str] | None = None,
                 ts: str | None = None) -> dict:
    last = conn.execute("SELECT hash FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()
    prev_hash = last["hash"] if last else "sha256:genesis"
    n = conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0] + 1
    ts = ts or datetime.now(TZ).isoformat(timespec="seconds")
    signers = signers if signers is not None else ["ork"]
    body = {"ts": ts, "actor": actor, "actor_type": actor_type, "action": action, "target": target,
            "outcome": outcome, "incident_id": incident_id, "request_id": request_id,
            "payload": payload or {}, "signers": signers}
    h = _hash(body, prev_hash)
    sig = f"sig:{h[7:11]}…{h[-4:]} (14/20 ORK)"
    event = {"id": f"ae_{n:04d}", **body, "signature": sig, "prev_hash": prev_hash, "hash": h, "verified": True}
    conn.execute(
        "INSERT INTO audit_events (id, ts, actor, actor_type, action, target, outcome, incident_id, request_id,"
        " payload_json, signers_json, signature, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (event["id"], ts, actor, actor_type, action, target, outcome, incident_id, request_id,
         json.dumps(body["payload"], ensure_ascii=False), json.dumps(signers), sig, prev_hash, h))
    conn.commit()
    return event
