"""Read models and actions for /me, governance, agents, admin, audit and receipt (docs/API.md §5.1, §5.7-5.9)."""
import json
import sqlite3
from datetime import timedelta

from .access import AccessService, CreateRequest, person
from .audit_log import _hash
from .auth import HOME_BY_ROLE, SEED_USERS, User
from .clock import iso, now, parse
from .errors import ApiError
from .policy import CAPABILITY_ROLES, Policy

MAP_CAPS = ["customer_pii.selfdecrypt", "roles.grant", "secrets.rotate", "policy.edit", "audit.write"]
QUORUM_ONLY = {"roles.grant", "policy.edit", "audit.write"}
MOCK_ROWS, MOCK_BYTES = 48201, 71302944


def _json(s: str | None, default):
    return json.loads(s) if s else default


class Insights:
    def __init__(self, app):
        self.app = app

    @property
    def db(self) -> sqlite3.Connection:
        return self.app.state.db

    @property
    def access(self) -> AccessService:
        return self.app.state.access

    def mock(self, name: str):
        return json.loads((self.app.state.settings.mocks_dir / name).read_text(encoding="utf-8"))

    def _clock(self):
        return now() + timedelta(minutes=getattr(self.app.state, "clock_offset_min", 0))

    # ---- /me

    def roles_of(self, user: User) -> list[str]:
        if self.app.state.settings.auth_mode == "tide":
            return list(user.roles)
        try:
            return self.app.state.governance.user_roles(user.username)
        except NotImplementedError:
            return list(user.roles)

    def me(self, user: User) -> dict:
        roles = self.roles_of(user)
        open_requests = self.db.execute(
            "SELECT COUNT(*) FROM access_requests WHERE status = 'pending' AND (requester = ? OR target_user = ?)",
            (user.username, user.username)).fetchone()[0]
        run = self.db.execute("SELECT context_flagged, context_quarantined FROM agent_runs WHERE agent = ?"
                              " ORDER BY started_at DESC LIMIT 1", (user.username,)).fetchone()
        return {"user": user.public(), "roles": roles,
                "home": next((h for r, h in HOME_BY_ROLE if r in roles), "/"),
                "authority": self.access.authority(user.username), "open_requests": open_requests,
                "context_flagged": bool(run and run["context_flagged"] and not run["context_quarantined"])}

    # ---- governance

    def change_text(self, r: sqlite3.Row) -> str:
        scope = _json(r["scope_json"], {})
        if r["type"] == "audit_delete":
            return f"delete audit event {scope.get('audit_event_id', '')}".strip()
        if r["type"] == "policy_change":
            return f"change policy {scope.get('version', '')}".strip()
        roles = _json(r["roles_json"], [])
        verb = "revoke" if r["type"] == "revoke_role" else "grant"
        what = ", ".join(roles) if r["capability"] == "roles.grant" and roles else r["capability"]
        extra = []
        if r["duration_min"]:
            extra.append(f"{r['duration_min']}m")
        if scope.get("record_ids"):
            extra.append(f"{len(scope['record_ids'])} records")
        text = f"{verb} {what}" + (f" ({', '.join(extra)})" if extra else "")
        flags = _json(r["flags_json"], [])
        if "self_grant" in flags:
            text += " to self"
        elif r["target_user"] != r["requester"]:
            text += f" to {r['target_user']}"
        return text

    def queue_item(self, r: sqlite3.Row) -> dict:
        v = self.access.view(r)
        item = {"id": r["id"], "requester": person(r["requester"]), "change": self.change_text(r),
                "tier": r["tier"], "escalated": v["escalated"], "approvals": v["quorum"]["approvals"],
                "required": r["required"], "age_s": v["age_s"], "status": r["status"], "flags": v["flags"]}
        if v.get("flag_note"):
            item["flag_note"] = v["flag_note"]
        return item

    def pending_rows(self, where: str = "", args: tuple = ()) -> list[sqlite3.Row]:
        return self.db.execute(
            f"SELECT * FROM access_requests WHERE status = 'pending' {where} ORDER BY created_at, id", args).fetchall()

    def active_grants(self) -> list[sqlite3.Row]:
        at = iso(self._clock())
        return [g for g in self.db.execute("SELECT * FROM role_grants")
                if not g["expires_at"] or g["expires_at"] > at]

    def overview(self) -> dict:
        row = self.db.execute("SELECT version, signed_by_json, signature FROM policy_versions"
                              " ORDER BY created_at DESC, version DESC LIMIT 1").fetchone()
        elevated = {g["username"] for g in self.active_grants() if SEED_USERS.get(g["username"]) and
                    SEED_USERS[g["username"]].type == "agent"}
        since = iso(now() - timedelta(hours=24))
        detections = self.db.execute(
            "SELECT COUNT(*) FROM injection_events WHERE label != 'BENIGN' AND ts >= ?", (since,)).fetchone()[0]
        queue = [self.queue_item(r) for r in self.pending_rows()]
        return {"stats": {"pending_change_requests": len(queue), "agents_elevated_now": len(elevated),
                          "injection_detections_24h": detections,
                          "policy_version": row["version"] if row else Policy.load(self.db).body["version"],
                          "policy_signed": bool(row and _json(row["signed_by_json"], []) and row["signature"])},
                "queue": queue}

    def authority_map(self) -> dict:
        identities = []
        for u in SEED_USERS.values():
            auth = {a["capability"]: a for a in self.access.authority(u.username, MAP_CAPS)}
            cells = {}
            for cap in MAP_CAPS:
                state = auth[cap]["state"]
                cells[cap] = "locked" if cap in QUORUM_ONLY and state == "pending" else state
            identities.append({"username": u.username, "display_name": u.display_name, "type": u.type,
                               "cells": cells})
        return {"capabilities": MAP_CAPS, "identities": identities,
                "legend": {"allowed": "✓", "pending": "⏳", "locked": "🔒", "granted": "⏱"}}

    # ---- agents

    def _registry(self) -> list[dict]:
        return self.mock("agents.json")["items"]

    def agent_card(self, entry: dict) -> dict:
        username = entry["username"]
        if username not in SEED_USERS:
            return entry
        pending = self.pending_rows("AND (requester = ? OR target_user = ?)", (username, username))
        run = self.db.execute("SELECT * FROM agent_runs WHERE agent = ? ORDER BY started_at DESC LIMIT 1",
                              (username,)).fetchone()
        status = "waiting_approval" if pending else (
            run["status"] if run and run["status"] in ("running", "paused") else "idle")
        last = self.db.execute("SELECT ts, action FROM audit_events WHERE actor = ? ORDER BY rowid DESC LIMIT 1",
                               (username,)).fetchone()
        flags = (["pending_request"] if pending else []) + (
            ["context_flagged"] if run and run["context_flagged"] and not run["context_quarantined"] else [])
        return {**entry, "status": status, "authority": self.access.authority(username),
                "runs_today": self.db.execute("SELECT COUNT(*) FROM agent_runs WHERE agent = ?",
                                              (username,)).fetchone()[0],
                "last_action": {"ts": last["ts"], "label": last["action"]} if last else entry.get("last_action"),
                "flags": flags}

    def agents(self) -> dict:
        return {"items": [self.agent_card(e) for e in self._registry()]}

    def agent_detail(self, username: str) -> dict:
        entry = next((e for e in self._registry() if e["username"] == username), None)
        if entry is None:
            raise ApiError(404, "not_found", f"agent {username} not found")
        card = self.agent_card(entry)
        runs = [{"id": r["id"], "incident_id": r["incident_id"], "status": r["status"], "started_at": r["started_at"],
                 "steps_count": self.db.execute("SELECT COUNT(*) FROM agent_steps WHERE run_id = ?",
                                                (r["id"],)).fetchone()[0]}
                for r in self.db.execute("SELECT * FROM agent_runs WHERE agent = ? ORDER BY started_at DESC",
                                         (username,))]
        events = [{"id": e["id"], "run_id": e["run_id"], "source": e["source"], "text": e["text"],
                   "label": e["label"], "score": e["score"], "lang": e["lang"], "ts": e["ts"],
                   "quarantined": bool(e["quarantined"])}
                  for e in self.db.execute(
                      "SELECT i.* FROM injection_events i JOIN agent_runs r ON r.id = i.run_id"
                      " WHERE r.agent = ? ORDER BY i.ts", (username,))]
        return {**card, "runs": runs,
                "requests": [self.queue_item(r) for r in self.pending_rows("AND requester = ?", (username,))],
                "injection_events": events,
                "kill_switch": {"label": "Revoke all elevated access", "note": "Reducing authority is instant."}}

    async def revoke_all(self, user: User, username: str) -> dict:
        if not any(e["username"] == username for e in self._registry()):
            raise ApiError(404, "not_found", f"agent {username} not found")
        gov, ts = self.app.state.governance, iso(now())
        roles = sorted({g["role"] for g in self.db.execute("SELECT role FROM role_grants WHERE username = ?",
                                                           (username,))})
        if roles:
            gov.revoke_role(username, roles)
            for r in self.db.execute("SELECT id, roles_json FROM access_requests WHERE target_user = ?"
                                     " AND status = 'approved'", (username,)).fetchall():
                if set(_json(r["roles_json"], [])) & set(roles):
                    self.db.execute("UPDATE access_requests SET status='revoked' WHERE id = ?", (r["id"],))
        withdrawn = []
        for r in self.pending_rows("AND requester = ?", (username,)):
            self.db.execute("UPDATE access_requests SET status='withdrawn', decided_at=? WHERE id=?", (ts, r["id"]))
            withdrawn.append(r["id"])
        run = self.db.execute("SELECT * FROM agent_runs WHERE agent = ? AND status IN ('running','waiting_approval')"
                              " ORDER BY started_at DESC", (username,)).fetchall()
        for r in run:
            self.db.execute("UPDATE agent_runs SET status='paused' WHERE id = ?", (r["id"],))
        self.db.commit()
        await self.access._audit(actor=user.username, actor_type=user.type, action="agent.revoke_all",
                                 target=username, outcome="revoked", payload={"revoked": roles, "withdrawn": withdrawn})
        hub = self.app.state.hub
        for rid in withdrawn:
            r = self.access.row(rid)
            await self.access._publish_request(r, "request.updated")
        for r in run:
            await hub.publish([f"run:{r['id']}", f"incident:{r['incident_id']}", "role:security-lead"],
                              "agent.run.status", {"run_id": r["id"], "status": "paused", "reason": "revoke-all"})
        caps = [c for c, tr in CAPABILITY_ROLES.items() if set(tr) & set(roles)]
        for cap in caps:
            await self.access._publish_authority(username, cap, refresh=True)
        return {"user": username, "revoked": roles, "withdrawn_requests": withdrawn,
                "run_paused": run[0]["id"] if run else None, "quorum_required": False,
                "note": "Reducing authority is instant.", "ts": ts}

    # ---- admin

    def admin_users(self) -> dict:
        last = {i["username"]: i["last_login"] for i in self.mock("admin-users.json")["items"]}
        gov = self.app.state.governance
        items = []
        for u in SEED_USERS.values():
            pend = [r["id"] for r in self.pending_rows("AND target_user = ?", (u.username,))]
            items.append({"username": u.username, "display_name": u.display_name, "type": u.type,
                          "roles": gov.user_roles(u.username), "last_login": last.get(u.username),
                          "pending_requests": pend})
        return {"items": items}

    def merchants(self, limit: int) -> dict:
        base = self.mock("admin-merchants.json")
        rows = self.db.execute("SELECT * FROM merchant_records ORDER BY id LIMIT ?", (limit,)).fetchall()
        if not rows:
            return {**base, "limit": limit, "items": base["items"][:limit]}
        total = self.db.execute("SELECT COUNT(*) FROM merchant_records").fetchone()[0]
        items = [{"id": r["id"], "name": r["ciphertext"], "bank_account": r["ciphertext"],
                  "tax_id": r["ciphertext"], "encrypted": True} for r in rows]
        return {**base, "tag": rows[0]["tag"], "total": total, "limit": limit, "items": items}

    async def export_merchants(self, user: User) -> dict:
        base = self.mock("admin-export.json")
        n, size = self.db.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(ciphertext)), 0) FROM merchant_records").fetchone()
        rows, size = (n, size) if n else (base["rows"], base["size_bytes"])
        ev = await self.access._audit(actor=user.username, actor_type=user.type, action="admin.data.export",
                                      target="merchants", outcome="allowed", payload={"rows": rows, "format": "ciphertext"})
        return {"rows": rows, "format": "ciphertext", "size_bytes": size,
                "file": f"merchants-export-{now().strftime('%Y-%m-%dT%H%M')}.enc.jsonl",
                "note": base["note"], "audit_event_id": ev["id"]}

    async def refuse_audit_delete(self, user: User, id_: str) -> None:
        ev = self.db.execute("SELECT id, incident_id FROM audit_events WHERE id = ?", (id_,)).fetchone()
        if ev is None:
            raise ApiError(404, "not_found", f"audit event {id_} not found")
        incident = ev["incident_id"] if ev["incident_id"] and self.db.execute(
            "SELECT 1 FROM incidents WHERE id = ?", (ev["incident_id"],)).fetchone() else None
        req = await self.access.create(user, CreateRequest(
            type="audit_delete", capability="audit.write", scope={"audit_event_id": id_},
            justification=f"Delete audit event {id_}", incident_id=incident))
        logged = await self.access._audit(
            actor=user.username, actor_type=user.type, action="admin.audit.delete", target=id_, outcome="blocked",
            incident_id=incident, request_id=req["id"],
            payload={"note": "Audit events are threshold-signed", "tier": req["tier"]})
        raise ApiError(403, "tide_refused",
                       "Audit events are threshold-signed. Deletion requires T3 quorum and is itself recorded.",
                       {"request_id": req["id"], "tier": req["tier"], "required": req["quorum"]["required"],
                        "recorded_as": logged["id"]})

    # ---- policies

    def policy_versions(self) -> dict:
        items = []
        for r in self.db.execute("SELECT * FROM policy_versions ORDER BY created_at DESC, version DESC"):
            signed = [s["username"] if isinstance(s, dict) else s for s in _json(r["signed_by_json"], [])]
            items.append({"version": r["version"], "created_at": r["created_at"], "signed_by": signed,
                          "hash": r["hash"], "signature": r["signature"], "change": r["change"]})
        return {"items": items}

    async def policy_draft(self, user: User, draft: dict) -> dict:
        if not draft:
            raise ApiError(422, "validation_error", "policy body required")
        version = str(draft.get("version", "draft"))
        req = await self.access.create(user, CreateRequest(
            type="policy_change", capability="policy.edit", scope={"version": version},
            evidence={"draft": draft}, justification=f"Policy change draft {version}"))
        return {"code": "quorum_required", "message": "Policy changes require T3 quorum.", "request": req}

    # ---- audit

    def _event(self, r: sqlite3.Row, verified: bool) -> dict:
        return {"id": r["id"], "ts": r["ts"], "actor": r["actor"], "actor_type": r["actor_type"],
                "action": r["action"], "target": r["target"], "outcome": r["outcome"],
                "incident_id": r["incident_id"], "request_id": r["request_id"],
                "payload": _json(r["payload_json"], {}), "signers": _json(r["signers_json"], []),
                "signature": r["signature"], "prev_hash": r["prev_hash"], "hash": r["hash"], "verified": verified}

    @staticmethod
    def _check(r: sqlite3.Row, prev_hash: str) -> str | None:
        body = {"ts": r["ts"], "actor": r["actor"], "actor_type": r["actor_type"], "action": r["action"],
                "target": r["target"], "outcome": r["outcome"], "incident_id": r["incident_id"],
                "request_id": r["request_id"], "payload": _json(r["payload_json"], {}),
                "signers": _json(r["signers_json"], [])}
        if r["prev_hash"] != prev_hash:
            return "prev_hash does not match the previous event hash"
        if _hash(body, r["prev_hash"]) != r["hash"]:
            return "stored hash does not match event content"
        return None

    def chain_status(self) -> dict[str, str | None]:
        out, prev = {}, "sha256:genesis"
        for r in self.db.execute("SELECT * FROM audit_events ORDER BY rowid"):
            out[r["id"]] = self._check(r, prev)
            prev = r["hash"]
        return out

    def audit_list(self, f: dict, limit: int, cursor: str | None) -> dict:
        where, args = ["1=1"], []
        for col, key in (("actor_type", "actor_type"), ("incident_id", "incident"), ("outcome", "outcome")):
            if f.get(key):
                where.append(f"{col} = ?")
                args.append(f[key])
        if f.get("capability"):
            cap = f["capability"]
            where.append("(action = ? OR target LIKE ? OR payload_json LIKE ? OR request_id IN"
                         " (SELECT id FROM access_requests WHERE capability = ?))")
            args += [cap, f"%{cap}%", f"%{cap}%", cap]
        if f.get("from"):
            where.append("ts >= ?")
            args.append(f["from"])
        if f.get("to"):
            where.append("ts <= ?")
            args.append(f["to"])
        sql = " AND ".join(where)
        total = self.db.execute(f"SELECT COUNT(*) FROM audit_events WHERE {sql}", args).fetchone()[0]
        try:
            after = int(cursor) if cursor else 0
        except ValueError:
            raise ApiError(422, "validation_error", "invalid cursor") from None
        rows = self.db.execute(f"SELECT rowid AS rid, * FROM audit_events WHERE {sql} AND rowid > ?"
                               " ORDER BY rowid LIMIT ?", [*args, after, limit + 1]).fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        status = self.chain_status()
        return {"filters": {k: v for k, v in f.items() if v}, "total": total,
                "next_cursor": str(rows[-1]["rid"]) if more else None, "chain": [r["id"] for r in rows],
                "items": [self._event(r, status[r["id"]] is None) for r in rows]}

    def audit_row(self, id_: str) -> sqlite3.Row:
        r = self.db.execute("SELECT * FROM audit_events WHERE id = ?", (id_,)).fetchone()
        if r is None:
            raise ApiError(404, "not_found", f"audit event {id_} not found")
        return r

    def audit_get(self, id_: str) -> dict:
        r = self.audit_row(id_)
        return self._event(r, self.chain_status()[id_] is None)

    def audit_verify(self, id_: str) -> dict:
        r = self.audit_row(id_)
        problem = self.chain_status()[id_]
        out = {"id": id_, "verified": problem is None, "hash": r["hash"], "prev_hash": r["prev_hash"],
               "signers": _json(r["signers_json"], []), "ork_nodes": "14/20", "signature": r["signature"],
               "verified_at": iso(now()), "method": "sha256-chain+mock-sig"}
        if problem:
            out["reason"] = problem
        return out

    # ---- incident access + receipt

    def _incident(self, id_: str) -> sqlite3.Row:
        r = self.db.execute("SELECT * FROM incidents WHERE id = ?", (id_,)).fetchone()
        if r is None:
            raise ApiError(404, "not_found", f"incident {id_} not found")
        return r

    def incident_access(self, id_: str) -> dict:
        self._incident(id_)
        items = []
        for r in self.db.execute("SELECT * FROM access_requests WHERE incident_id = ? ORDER BY created_at, id", (id_,)):
            v = self.access.view(r)
            items.append({"id": r["id"], "requester": person(r["requester"]), "capability": r["capability"],
                          "tier": r["tier"], "escalated": v["escalated"], "status": r["status"],
                          "approvals": v["quorum"]["approvals"], "required": r["required"],
                          "created_at": r["created_at"], "flags": v["flags"]})
        return {"incident_id": id_, "items": items}

    @staticmethod
    def _duration(seconds: float) -> str:
        s = max(0, int(seconds))
        return f"{s // 60}m{s % 60:02d}s"

    def receipt(self, id_: str) -> dict:
        inc = self._incident(id_)
        reqs = self.db.execute("SELECT * FROM access_requests WHERE incident_id = ? ORDER BY created_at, id",
                               (id_,)).fetchall()
        events = self.db.execute("SELECT * FROM audit_events WHERE incident_id = ? ORDER BY rowid", (id_,)).fetchall()
        by_id = {r["id"]: r for r in reqs}
        granted = [r for r in reqs if r["status"] in ("approved", "expired", "revoked") and r["granted_at"]]

        approvals = []
        for r in reqs:
            for a in self.access.approvals(r["id"]):
                approvals.append({"request_id": r["id"], "approver": a["approver"],
                                  "display_name": person(a["approver"])["display_name"],
                                  "signed_at": a["signed_at"], "signature": a["signature"]})

        accessed = [e for e in events if e["action"] == "data.accessed"]
        record_ids, fields = [], []
        for e in accessed:
            p = _json(e["payload_json"], {})
            record_ids += [x for x in p.get("record_ids", []) if x not in record_ids]
            fields += [x for x in p.get("fields", []) if x not in fields]

        ends, uses = [], []
        for r in granted:
            ended = next((e["ts"] for e in events if e["action"] == "request.expired" and e["request_id"] == r["id"]),
                         None)
            end = parse(ended) if ended else now()
            ends.append(end)
            uses.append((end - parse(r["granted_at"])).total_seconds())
        data = {"record_ids": record_ids, "fields": fields,
                "granted_min": sum(r["duration_min"] or 0 for r in granted) or None,
                "actual_use": self._duration(sum(uses)) if granted else None}

        blocked, seen = [], set()
        for e in events:
            if e["outcome"] not in ("blocked", "refused"):
                continue
            rid = e["request_id"]
            if rid and rid in seen:
                continue
            seen.add(rid)
            r = by_id.get(rid)
            what = f"{e['action']} {e['target']}"
            if r:
                what = self.change_text(r) + (" (injection-driven)" if "injection" in _json(r["flags_json"], []) else "")
            blocked.append({"request_id": rid, "actor": e["actor"], "what": what, "tier": r["tier"] if r else None})

        who = list(dict.fromkeys(r["target_user"] for r in granted))
        caps = list(dict.fromkeys(r["capability"] for r in granted))
        n_rec = len(record_ids) or sum(len(_json(r["scope_json"], {}).get("record_ids", [])) for r in granted)
        start = min((parse(r["granted_at"]) for r in granted), default=None)
        end = max(ends, default=None)
        window = None
        if start and end:
            window = f"{start:%Y-%m-%d %H:%M}–{end.astimezone(start.tzinfo):%H:%M} (+07:00)"
        finish = parse(inc["resolved_at"]) if inc["resolved_at"] else (parse(events[-1]["ts"]) if events else None)
        mttr = max(0, round((finish - parse(inc["started_at"])).total_seconds() / 60)) if finish else None
        return {
            "incident_id": id_, "title": f"Access Receipt · {id_}", "generated_at": iso(now()),
            "summary": {"who": [f"{u} ({person(u)['display_name']})" for u in who],
                        "what": " · ".join([", ".join(caps), f"{n_rec} records"]) if caps else "no elevated access",
                        "when": window, "mttr_min": mttr},
            "approvals": approvals, "data_accessed": data, "blocked_attempts": blocked,
            "signatures": [{"event": f"{e['action']} {e['request_id']}" if e["request_id"] else e["action"],
                            "hash": e["hash"], "signature": e["signature"]}
                           for e in events if e["action"] in ("request.approved", "data.accessed", "request.expired")],
            "footer": "Generated from threshold-signed audit events. No single party could have altered this record."}

