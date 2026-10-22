import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, title TEXT, service TEXT, severity TEXT, status TEXT,
  started_at TEXT, resolved_at TEXT, owner_agent TEXT, owner_human TEXT, error_rate REAL
);
CREATE TABLE IF NOT EXISTS services (
  name TEXT PRIMARY KEY, health TEXT, error_rate REAL, p95_ms INTEGER, current_deploy TEXT
);
CREATE TABLE IF NOT EXISTS deploys (
  version TEXT PRIMARY KEY, service TEXT, status TEXT, deployed_at TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS log_lines (
  id INTEGER PRIMARY KEY, service TEXT, ts TEXT, level TEXT, text TEXT, injected INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS merchant_records (
  id TEXT PRIMARY KEY, tag TEXT, ciphertext TEXT, encrypted_by TEXT, encrypted_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, incident_id TEXT REFERENCES incidents(id), agent TEXT, status TEXT,
  started_at TEXT, finished_at TEXT, context_flagged INTEGER DEFAULT 0,
  context_quarantined INTEGER DEFAULT 0, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY, run_id TEXT REFERENCES agent_runs(id), seq INTEGER, kind TEXT,
  tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, tier TEXT, call_id TEXT, ts TEXT
);
CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY, type TEXT, run_id TEXT REFERENCES agent_runs(id),
  incident_id TEXT REFERENCES incidents(id), requester TEXT, requester_type TEXT,
  target_user TEXT, capability TEXT, roles_json TEXT, scope_json TEXT, duration_min INTEGER,
  justification TEXT, evidence_json TEXT, base_tier TEXT, tier TEXT, escalated INTEGER DEFAULT 0,
  escalation_reason TEXT, required INTEGER, eligible_json TEXT, status TEXT, flags_json TEXT,
  tide_cr_id TEXT, signature TEXT, created_at TEXT, decided_at TEXT, granted_at TEXT, expires_at TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, request_id TEXT REFERENCES access_requests(id), approver TEXT,
  decision TEXT, duration_override_min INTEGER, signature TEXT, ork_nodes TEXT, signed_at TEXT
);
CREATE TABLE IF NOT EXISTS injection_events (
  id TEXT PRIMARY KEY, run_id TEXT REFERENCES agent_runs(id), source TEXT, text TEXT,
  label TEXT, score REAL, lang TEXT, ts TEXT, quarantined INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, ts TEXT, actor TEXT, actor_type TEXT, action TEXT, target TEXT,
  outcome TEXT, incident_id TEXT, request_id TEXT, payload_json TEXT, signers_json TEXT,
  signature TEXT, prev_hash TEXT, hash TEXT
);
CREATE TABLE IF NOT EXISTS policy_versions (
  version TEXT PRIMARY KEY, body_json TEXT, signed_by_json TEXT, hash TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user TEXT, group_name TEXT, title TEXT, body TEXT, request_id TEXT,
  read INTEGER DEFAULT 0, ts TEXT
);
"""


def connect(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: str) -> sqlite3.Connection:
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn
