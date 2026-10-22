"""Access requests: policy engine glue, quorum, apply/expire, notifications, WS fan-out.

Flows follow docs/API.md §4.3-4.6. Role changes only ever reach roles through
`TideGovernance.apply` after quorum; reductions (`revoke_role`) are instant.
"""
import asyncio
import json
import sqlite3
import uuid
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from .audit_log import append_audit
from .auth import SEED_USERS, User
from .clock import iso, now, parse
from .errors import ApiError
from .policy import CAPABILITY_ROLES, Policy, UnknownCapability

REQUEST_CHANNELS = ["role:oncall", "role:security-lead", "role:platform-admin"]
AUTHORITY_CAPS = ["services.restart", "deploy.rollback", "logs.read", "customer_pii.selfdecrypt",
                  "roles.grant", "secrets.rotate"]
GROUPS = [("approval", "Needs your approval"), ("agent", "Agent activity"), ("security", "Security")]
ORK = "14/20"
BLAST_RADIUS = {"customer_records": 48201, "could": ["read all customer records", "grant roles", "export data"]}


class CreateRequest(BaseModel):
    type: str = Field(pattern="^(grant_role|revoke_role|policy_change|audit_delete)$")
    capability: str
    target_user: str | None = None
    roles: list[str] | None = None
    scope: dict | None = None
    duration_min: int | None = Field(default=None, gt=0)
    justification: str = Field(min_length=1)
    evidence: dict | None = None
    run_id: str | None = None
    incident_id: str | None = None


class ApproveBody(BaseModel):
    duration_min: int | None = Field(default=None, gt=0)


class DenyBody(BaseModel):
    reason: str = Field(min_length=1)
    quarantine_agent_context: bool = False


class RolesBody(BaseModel):
    add: list[str] = []
    remove: list[str] = []


def person(username: str | None) -> dict | None:
    if username is None:
        return None
    u = SEED_USERS.get(username)
    return {"username": username, "display_name": u.display_name if u else username, "type": u.type if u else "human"}


def user_type(username: str) -> str:
    u = SEED_USERS.get(username)
    return u.type if u else "human"


class AccessService:
    def __init__(self, app):
        self.app = app

    @property
    def db(self) -> sqlite3.Connection:
        return self.app.state.db

    @property
    def hub(self):
        return self.app.state.hub

    @property
    def gov(self):
        return self.app.state.governance

    def policy(self) -> Policy:
        return Policy.load(self.db)

    def row(self, id_: str) -> sqlite3.Row:
        r = self.db.execute("SELECT * FROM access_requests WHERE id = ?", (id_,)).fetchone()
        if r is None:
            raise ApiError(404, "not_found", f"request {id_} not found")
        return r

    def _next_id(self, table: str, prefix: str, width: int) -> str:
        n = self.db.execute(
            f"SELECT MAX(CAST(SUBSTR(id, {len(prefix) + 1}) AS INTEGER)) AS n FROM {table} WHERE id LIKE ?",
            (f"{prefix}%",)).fetchone()["n"]
        return f"{prefix}{(n or 0) + 1:0{width}d}"

    def eligible_users(self, roles: list[str]) -> list[dict]:
        out = []
        for role in roles:
            for u in SEED_USERS.values():
                if role in u.roles:
                    out.append({"username": u.username, "display_name": u.display_name, "role": role})
        return out

    def approvals(self, id_: str) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM approvals WHERE request_id = ? AND decision = 'approve' ORDER BY signed_at, rowid",
            (id_,)).fetchall()

    def view(self, r: sqlite3.Row) -> dict:
        pol = self.policy()
        signed_by = [{"username": a["approver"], "display_name": person(a["approver"])["display_name"],
                      "signed_at": a["signed_at"], "signature": a["signature"], "ork_nodes": a["ork_nodes"]}
                     for a in self.approvals(r["id"])]
        eligible = json.loads(r["eligible_json"] or "[]")
        out = {
            "id": r["id"], "type": r["type"], "status": r["status"],
            "requester": person(r["requester"]), "target_user": r["target_user"],
            "capability": r["capability"], "roles": json.loads(r["roles_json"] or "[]"),
            "scope": json.loads(r["scope_json"] or "{}"), "duration_min": r["duration_min"],
            "justification": r["justification"], "evidence": json.loads(r["evidence_json"] or "{}"),
            "base_tier": r["base_tier"], "tier": r["tier"], "escalated": bool(r["escalated"]),
            "escalation_reason": r["escalation_reason"],
            "quorum": {"required": r["required"], "of": pol.tier_spec(r["tier"])["of"], "approvals": len(signed_by),
                       "eligible": self.eligible_users(eligible), "signed_by": signed_by,
                       "requester_cannot_approve": True},
            "safety_checks": json.loads(r["safety_checks_json"] or "[]"),
            "flags": json.loads(r["flags_json"] or "[]"),
            "security_context": json.loads(r["security_context_json"]) if r["security_context_json"] else None,
            "incident_id": r["incident_id"], "run_id": r["run_id"], "tide_cr_id": r["tide_cr_id"],
            "signature": r["signature"], "created_at": r["created_at"], "decided_at": r["decided_at"],
            "granted_at": r["granted_at"], "expires_at": r["expires_at"],
            "age_s": max(0, int((now() - parse(r["created_at"])).total_seconds())),
        }
        if r["apply_status"]:
            out["apply_status"] = r["apply_status"]
            out["tide_change_request_id"] = r["tide_change_request_id"]
        decision = json.loads(r["decision_json"]) if r["decision_json"] else {}
        out.update(decision)
        return out

    def _eligible_roles(self, r: sqlite3.Row) -> list[str]:
        return json.loads(r["eligible_json"] or "[]")

    def _never_for_agent(self, pol: Policy, r: sqlite3.Row) -> bool:
        return pol.agent_forbidden(r["capability"]) and "agent" in (r["requester_type"], user_type(r["target_user"]))

    async def _publish_request(self, r: sqlite3.Row, type_: str, payload: dict | None = None) -> None:
        channels = REQUEST_CHANNELS + [f"user:{r['requester']}"]
        if r["incident_id"]:
            channels.append(f"incident:{r['incident_id']}")
        await self.hub.publish(channels, type_, payload if payload is not None else self.view(r))

    async def _audit(self, **kw) -> dict:
        ev = append_audit(self.db, **kw)
        await self.hub.publish("global", "audit.appended", ev)
        return ev

    def authority(self, username: str, caps: list[str] | None = None) -> list[dict]:
        pol = self.policy()
        roles = self.gov.user_roles(username)
        is_agent = user_type(username) == "agent"
        grants = {r["role"] for r in self.db.execute(
            "SELECT role FROM role_grants WHERE username = ?", (username,))}
        out = []
        for cap in caps or AUTHORITY_CAPS:
            tide_roles = CAPABILITY_ROLES.get(cap, [])
            if pol.body["capability_tier"].get(cap) == "T0":
                out.append({"capability": cap, "state": "allowed"})
                continue
            entry: dict = {"capability": cap}
            if is_agent and pol.agent_forbidden(cap):
                out.append({**entry, "state": "locked", "reason": "never grantable to agents"})
                continue
            if tide_roles:
                entry["tide_role"] = tide_roles[0]
            held = bool(tide_roles) and all(r in roles for r in tide_roles)
            active = self.db.execute(
                "SELECT id, expires_at FROM access_requests WHERE target_user = ? AND capability = ?"
                " AND status = 'approved' ORDER BY granted_at DESC LIMIT 1", (username, cap)).fetchone()
            pending = self.db.execute(
                "SELECT id FROM access_requests WHERE target_user = ? AND capability = ? AND status = 'pending'"
                " LIMIT 1", (username, cap)).fetchone()
            if held and not all(r in grants for r in tide_roles):
                entry["state"] = "allowed"
            elif held:
                entry["state"] = "granted"
                if active:
                    entry.update(expires_at=active["expires_at"], request_id=active["id"])
            elif pending:
                entry.update(state="pending", request_id=pending["id"])
            else:
                entry["state"] = "locked"
            out.append(entry)
        return out

    async def _publish_authority(self, username: str, capability: str, refresh: bool = False) -> None:
        authority = self.authority(username)
        entry = next((a for a in authority if a["capability"] == capability), None)
        if entry is None or (entry["state"] == "locked" and entry.get("reason")):
            return
        changed = {k: entry[k] for k in ("capability", "state", "expires_at") if k in entry}
        await self.hub.publish([f"user:{username}", "role:security-lead"], "authority.updated",
                               {"user": username, "authority": authority, "changed": changed,
                                "token_refresh_required": refresh})

    async def _notify(self, users: list[str], group: str, title: str, body: str, r: sqlite3.Row | None,
                      meta: dict | None = None) -> None:
        for username in users:
            nid = self._next_id("notifications", "ntf_", 2)
            ts = iso(now())
            self.db.execute(
                "INSERT INTO notifications (id, user, group_name, title, body, request_id, read, ts, meta_json)"
                " VALUES (?,?,?,?,?,?,0,?,?)",
                (nid, username, group, title, body, r["id"] if r else None, ts, json.dumps(meta or {})))
            self.db.commit()
            payload = {"id": nid, "group": group, "title": title, "request_id": r["id"] if r else None}
            if r:
                payload.update(tier=r["tier"], approvals=len(self.approvals(r["id"])), required=r["required"])
            await self.hub.publish(f"user:{username}", "notification", payload)

    def _title(self, r: sqlite3.Row) -> str:
        scope = json.loads(r["scope_json"] or "{}")
        who = person(r["requester"])["display_name"]
        parts = [f"{who} requests {r['capability']}"]
        if scope.get("record_ids"):
            parts.append(f"{len(scope['record_ids'])} records")
        elif scope.get("roles"):
            parts.append(", ".join(scope["roles"]))
        if r["target_user"] != r["requester"]:
            parts.append(f"for {r['target_user']}")
        if r["duration_min"]:
            parts.append(f"{r['duration_min']} min")
        return " · ".join(parts)

    def _safety_checks(self, pol: Policy, *, flagged: bool, has_run: bool, never_agent: bool, capability: str,
                       scope: dict, tier: str, base_tier: str, duration: int | None, requester_type: str) -> list[dict]:
        checks = []
        if has_run:
            checks.append({"id": "injection_scan", "label": "Injection scan of agent context",
                           "status": "fail" if flagged else "pass",
                           "detail": "injection detected" if flagged else "clean"})
        if never_agent:
            checks.append({"id": "agent_never_holds", "label": "Agents can never hold roles.grant", "status": "fail"})
        if capability in ("customer_pii.selfdecrypt", "roles.grant"):
            ids = scope.get("record_ids")
            if ids:
                checks.append({"id": "scope", "label": "Scope limited to incident records", "status": "pass",
                               "detail": f"{len(ids)} of 48,201 records"})
            else:
                checks.append({"id": "scope", "label": "Scope limited to incident records", "status": "fail",
                               "detail": "unscoped"})
        limit = pol.max_duration(base_tier)
        if limit is not None:
            ok = duration is not None and duration <= limit
            checks.append({"id": "duration", "label": f"Duration ≤ policy max ({limit} min)",
                           "status": "pass" if ok else "fail",
                           "detail": f"{duration} min" if duration else "no duration"})
        if requester_type == "agent":
            checks.append({"id": "requester_type", "label": "Requester is agent → human quorum required",
                           "status": "info"})
        else:
            checks.append({"id": "requester_cannot_approve", "label": "Your approval is not counted on your own request",
                           "status": "info"})
        return checks

    def _security_context(self, *, flagged: bool, run_id: str | None, flags: list[str], capability: str,
                          roles: list[str], target: str, requester: str) -> dict | None:
        if flagged:
            ev = self.db.execute("SELECT * FROM injection_events WHERE run_id = ? ORDER BY ts DESC LIMIT 1",
                                 (run_id,)).fetchone()
            ctx = {"why_flagged": "Requested while the agent context is flagged for prompt injection"}
            if ev:
                ctx = {"why_flagged": f"Requested by agent immediately after processing log line containing "
                                      f"{ev['label']} ({ev['score']}, {ev['lang']})",
                       "injection_event_id": ev["id"], "line": ev["text"]}
            return {**ctx, "blast_radius": BLAST_RADIUS}
        if "agent_target" in flags:
            return {"why_flagged": f"{person(requester)['display_name']} attempted to grant {', '.join(roles) or capability}"
                                   f" to an agent identity without quorum",
                    "blast_radius": BLAST_RADIUS}
        if "self_grant" in flags:
            return {"why_flagged": f"{requester} requested {capability} for themselves", "blast_radius": BLAST_RADIUS}
        return None

    async def create(self, user: User, body: CreateRequest, extra_flags: list[str] | None = None) -> dict:
        pol = self.policy()
        run = None
        if body.run_id:
            run = self.db.execute("SELECT * FROM agent_runs WHERE id = ?", (body.run_id,)).fetchone()
            if run is None:
                raise ApiError(422, "validation_error", f"unknown run_id {body.run_id}")
        incident_id = body.incident_id or (run["incident_id"] if run else None)
        if incident_id and not self.db.execute("SELECT 1 FROM incidents WHERE id = ?", (incident_id,)).fetchone():
            raise ApiError(422, "validation_error", f"unknown incident_id {incident_id}")
        target = body.target_user or user.username
        if user.type == "agent" and target != user.username:
            raise ApiError(403, "forbidden", "agents can only request access for themselves")
        flagged = bool(run and run["context_flagged"])
        try:
            dec = pol.decide(body.capability, flagged)
        except UnknownCapability:
            raise ApiError(422, "validation_error", f"unknown capability {body.capability}") from None
        roles = body.roles if body.roles is not None else CAPABILITY_ROLES.get(body.capability, [])
        if body.type == "revoke_role":
            if not roles:
                raise ApiError(422, "validation_error", "revoke_role needs roles")
            return await self.instant_revoke(user, target, roles, body.justification, incident_id, body.capability)

        spec = pol.tier_spec(dec.tier)
        duration = body.duration_min
        limits = [m for m in (pol.max_duration(dec.base_tier), pol.max_duration(dec.tier)) if m is not None]
        if duration is None and limits:
            duration = min(limits)
        if duration is not None and limits and duration > min(limits):
            raise ApiError(422, "validation_error", f"duration exceeds policy max of {min(limits)} min",
                           {"max_duration_min": min(limits)})

        flags = list(dec.flags)
        if target == user.username and user.type != "agent" and body.type == "grant_role":
            flags.append("self_grant")
        if user_type(target) == "agent" and user.type != "agent" and body.capability == "roles.grant":
            flags.append("agent_target")
        flags = list(dict.fromkeys([*(extra_flags or []), *flags]))
        flags.sort(key=lambda f: ["injection", "security_review"].index(f) if f in ("injection", "security_review") else 99)

        scope = dict(body.scope or {})
        if "record_ids" in scope:
            scope["count"] = len(scope["record_ids"])
        elif roles and not scope:
            scope = {"roles": roles, "count": len(roles)}
        id_ = self._next_id("access_requests", "CR-", 4)
        never_agent = pol.agent_forbidden(body.capability) and "agent" in (user.type, user_type(target))
        checks = self._safety_checks(pol, flagged=flagged, has_run=run is not None, never_agent=never_agent,
                                     capability=body.capability, scope=scope, tier=dec.tier, base_tier=dec.base_tier,
                                     duration=duration, requester_type=user.type)
        ctx = self._security_context(flagged=flagged, run_id=body.run_id, flags=flags, capability=body.capability,
                                     roles=roles, target=target, requester=user.username)
        created = iso(now())
        tide_cr = self.gov.propose_role_change(target, roles, [], body.justification,
                                               {"required": spec["required"], "request_id": id_})
        self.db.execute(
            "INSERT INTO access_requests (id, type, run_id, incident_id, requester, requester_type, target_user,"
            " capability, roles_json, scope_json, duration_min, justification, evidence_json, base_tier, tier,"
            " escalated, escalation_reason, required, eligible_json, status, flags_json, tide_cr_id, created_at,"
            " safety_checks_json, security_context_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (id_, body.type, body.run_id, incident_id, user.username, user.type, target, body.capability,
             json.dumps(roles), json.dumps(scope), duration, body.justification, json.dumps(body.evidence or {}),
             dec.base_tier, dec.tier, int(dec.escalated), dec.escalation_reason, spec["required"],
             json.dumps(spec["eligible"]), "pending", json.dumps(flags), tide_cr, created,
             json.dumps(checks), json.dumps(ctx) if ctx else None))
        self.db.commit()
        r = self.row(id_)
        await self._audit(actor=user.username, actor_type=user.type, action="request.create",
                          target=f"{body.capability}:{target}", outcome="blocked" if never_agent else "pending",
                          incident_id=incident_id, request_id=id_,
                          payload={"tier": dec.tier, "escalated": dec.escalated, "flags": flags})
        await self._publish_request(r, "request.created")
        if spec["required"] == 0:
            return await self._apply(r, [])
        await self._publish_authority(target, body.capability)
        approvers = [u["username"] for u in self.eligible_users(spec["eligible"]) if u["username"] != user.username]
        approvers = list(dict.fromkeys(approvers))
        body_txt = f"{incident_id or 'no incident'} · {dec.tier} · {spec['label']}"
        await self._notify(approvers, "approval", self._title(r), body_txt, r)
        if dec.escalated or "agent_target" in flags or "self_grant" in flags:
            sec = [u.username for u in SEED_USERS.values() if "security-lead" in u.roles and u.username != user.username]
            title = ("Suspected prompt injection in Atlas context" if dec.escalated
                     else f"Flagged request {id_} · {body.capability}")
            await self._notify(sec, "security", title, f"{', '.join(flags)} · {dec.tier}", r)
        return self.view(self.row(id_))

    async def instant_revoke(self, user: User, target: str, roles: list[str], reason: str,
                             incident_id: str | None = None, capability: str = "roles.grant") -> dict:
        if user.type == "agent" and target != user.username:
            raise ApiError(403, "forbidden", "agents can only reduce their own authority")
        id_ = self._next_id("access_requests", "CR-", 4)
        ts = iso(now())
        self.gov.revoke_role(target, roles)
        self.db.execute(
            "INSERT INTO access_requests (id, type, incident_id, requester, requester_type, target_user, capability,"
            " roles_json, scope_json, justification, evidence_json, base_tier, tier, escalated, required,"
            " eligible_json, status, flags_json, created_at, decided_at, safety_checks_json)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?)",
            (id_, "revoke_role", incident_id, user.username, user.type, target, capability, json.dumps(roles),
             json.dumps({"roles": roles, "count": len(roles)}), reason, "{}", "T0", "T0", "[]", "revoked", "[]",
             ts, ts, json.dumps([{"id": "reduce_authority", "label": "Reducing authority is instant",
                                  "status": "pass"}])))
        self.db.commit()
        r = self.row(id_)
        await self._audit(actor=user.username, actor_type=user.type, action="role.revoke",
                          target=f"{','.join(roles)}:{target}", outcome="revoked", incident_id=incident_id,
                          request_id=id_, payload={"roles": roles})
        await self._publish_request(r, "request.created")
        await self._publish_authority(target, capability, refresh=True)
        return self.view(r)

    def list_requests(self, user: User, status: str | None, incident: str | None, requester: str | None,
             flagged: bool | None) -> dict:
        q, args = "SELECT * FROM access_requests WHERE 1=1", []
        for col, val in (("status", status), ("incident_id", incident), ("requester", requester)):
            if val:
                q += f" AND {col} = ?"
                args.append(val)
        if user.type == "agent":
            q += " AND requester = ?"
            args.append(user.username)
        rows = self.db.execute(q + " ORDER BY created_at, id", args).fetchall()
        items = [self.view(r) for r in rows]
        if flagged is not None:
            items = [i for i in items if bool(i["flags"]) == flagged]
        return {"items": items, "total": len(items)}

    def get(self, user: User, id_: str) -> dict:
        r = self.row(id_)
        if user.type == "agent" and r["requester"] != user.username:
            raise ApiError(403, "forbidden", "agents can only read their own requests")
        return self.view(r)

    def _check_decider(self, user: User, r: sqlite3.Row) -> None:
        if r["status"] != "pending":
            raise ApiError(409, "invalid_state", f"request is {r['status']}")
        if user.username == r["requester"]:
            raise ApiError(403, "forbidden", "requester cannot approve their own request",
                           {"reason": "requester_cannot_approve"})
        if not any(role in user.roles for role in self._eligible_roles(r)):
            raise ApiError(403, "forbidden", f"one of roles {self._eligible_roles(r)} required",
                           {"reason": "not_eligible"})

    async def approve(self, user: User, id_: str, body: ApproveBody) -> dict:
        r = self.row(id_)
        pol = self.policy()
        self._check_decider(user, r)
        if self._never_for_agent(pol, r):
            raise ApiError(403, "forbidden", "agents can never hold roles.grant; deny this request",
                           {"reason": "agent_never_holds"})
        if user.username in [a["approver"] for a in self.approvals(id_)]:
            raise ApiError(409, "invalid_state", "already approved by you")
        limit = pol.max_duration(r["tier"])
        if body.duration_min and limit and body.duration_min > limit:
            raise ApiError(422, "validation_error", f"duration exceeds policy max of {limit} min",
                           {"max_duration_min": limit})
        res = self.gov.approve(r["tide_cr_id"], user.username)
        await self._signing_ticks(id_, user.username)
        ts = iso(now())
        self.db.execute(
            "INSERT INTO approvals (id, request_id, approver, decision, duration_override_min, signature, ork_nodes,"
            " signed_at) VALUES (?,?,?,?,?,?,?,?)",
            (f"apr_{uuid.uuid4().hex[:8]}", id_, user.username, "approve", body.duration_min, res.signature,
             res.ork_nodes or ORK, ts))
        self.db.commit()
        signed = self.approvals(id_)
        if len(signed) >= r["required"]:
            return await self._apply(self.row(id_), signed, user)
        await self._audit(actor=user.username, actor_type="human", action="request.approve",
                          target=f"{r['capability']}:{r['target_user']}", outcome="signed", incident_id=r["incident_id"],
                          request_id=id_, payload={"approvals": len(signed), "required": r["required"]},
                          signers=[user.username])
        r = self.row(id_)
        await self._publish_request(r, "request.updated")
        return self.view(r)

    async def _signing_ticks(self, id_: str, approver: str) -> None:
        delay = self.app.state.settings.signing_tick_s
        for i in range(1, 6):
            await self.hub.publish(f"user:{approver}", "signing.progress", {
                "request_id": id_, "step": "signed" if i == 5 else "collecting_signature",
                "ork_done": round(14 * i / 5), "ork_total": 20})
            if delay:
                await asyncio.sleep(delay)

    async def _apply(self, r: sqlite3.Row, signed: list[sqlite3.Row], user: User | None = None) -> dict:
        roles = json.loads(r["roles_json"] or "[]")
        overrides = [a["duration_override_min"] for a in signed if a["duration_override_min"]]
        duration = min(overrides) if overrides else r["duration_min"]
        granted = now()
        expires = iso(granted + timedelta(minutes=duration)) if roles and duration else None
        apply_status, tide_ids, apply_error = None, None, None
        if roles:
            try:
                self.gov.apply(r["tide_cr_id"], r["target_user"], roles, [], expires)
                apply_status = "applied"
                tide_ids = ",".join(getattr(self.gov, "last_change_request_ids", [])) or None
            except ApiError as exc:
                apply_status, apply_error, expires = "failed", exc.message, None
        sig = signed[-1]["signature"] if signed else None
        ts = iso(granted)
        self.db.execute(
            "UPDATE access_requests SET status='approved', decided_at=?, granted_at=?, expires_at=?, signature=?,"
            " duration_min=?, apply_status=?, tide_change_request_id=? WHERE id=?",
            (ts, None if apply_error else ts, expires, f"{sig} ({ORK} ORK)" if sig else None, duration,
             apply_status, tide_ids, r["id"]))
        self.db.commit()
        r = self.row(r["id"])
        signers = [a["approver"] for a in signed] or ["policy"]
        await self._audit(actor=user.username if user else "policy", actor_type="human" if user else "system",
                          action="request.approved", target=f"{r['capability']}:{r['target_user']}",
                          outcome="signed", incident_id=r["incident_id"], request_id=r["id"],
                          payload={"tier": r["tier"], "roles": roles, "expires_at": expires, "apply_status": apply_status,
                                   "tide_change_request_id": tide_ids, "apply_error": apply_error},
                          signers=signers)
        full = self.view(r)
        if not apply_error:
            await self._publish_request(r, "request.approved", {
                "id": r["id"], "signature": sig, "ork_nodes": ORK, "signed_by": full["quorum"]["signed_by"],
                "granted_at": ts, "expires_at": expires, "capability": r["capability"],
                "target_user": r["target_user"]})
        await self._publish_request(r, "request.updated", full)
        await self._publish_authority(r["target_user"], r["capability"], refresh=True)
        if r["requester_type"] == "agent" and not apply_error:
            await self._notify([r["requester"]], "agent", f"Request {r['id']} approved",
                               f"{r['capability']} granted" + (f" until {expires}" if expires else ""), r)
        return full

    async def deny(self, user: User, id_: str, body: DenyBody) -> dict:
        r = self.row(id_)
        self._check_decider(user, r)
        decision = {**json.loads(r["decision_json"] or "{}"), "denied_by": person(user.username),
                    "deny_reason": body.reason, "quarantined": bool(body.quarantine_agent_context and r["run_id"])}
        if decision["quarantined"]:
            self.db.execute("UPDATE agent_runs SET context_quarantined = 1 WHERE id = ?", (r["run_id"],))
        self.db.execute("UPDATE access_requests SET status='denied', decided_at=?, decision_json=? WHERE id=?",
                        (iso(now()), json.dumps(decision), id_))
        self.db.commit()
        r = self.row(id_)
        await self._audit(actor=user.username, actor_type="human", action="request.deny",
                          target=f"{r['capability']}:{r['target_user']}", outcome="refused",
                          incident_id=r["incident_id"], request_id=id_,
                          payload={"reason": body.reason, "quarantined": decision["quarantined"]})
        await self._publish_request(r, "request.denied", {"id": id_, "reason": body.reason, "by": user.username,
                                                          "quarantined": decision["quarantined"]})
        await self._publish_request(r, "request.updated")
        await self._publish_authority(r["target_user"], r["capability"])
        if r["requester_type"] == "agent":
            await self._notify([r["requester"]], "agent", f"Request {id_} denied", body.reason, r)
        return self.view(r)

    async def withdraw(self, user: User, id_: str) -> dict:
        r = self.row(id_)
        if user.username != r["requester"]:
            raise ApiError(403, "forbidden", "only the requester can withdraw", {"reason": "not_requester"})
        if r["status"] != "pending":
            raise ApiError(409, "invalid_state", f"request is {r['status']}")
        self.db.execute("UPDATE access_requests SET status='withdrawn', decided_at=? WHERE id=?",
                        (iso(now()), id_))
        self.db.commit()
        r = self.row(id_)
        await self._audit(actor=user.username, actor_type=user.type, action="request.withdraw",
                          target=f"{r['capability']}:{r['target_user']}", outcome="allowed",
                          incident_id=r["incident_id"], request_id=id_)
        await self._publish_request(r, "request.updated")
        await self._publish_authority(r["target_user"], r["capability"])
        return self.view(r)

    async def put_roles(self, user: User, username: str, body: RolesBody) -> tuple[int, dict]:
        if not body.add and not body.remove:
            raise ApiError(422, "validation_error", "add or remove required")
        removed = None
        if body.remove:
            removed = await self.instant_revoke(user, username, body.remove, f"Edit roles · {username} (admin console)")
        if not body.add:
            return 200, {"code": "applied", "message": "Authority reduced immediately; no quorum needed.",
                         "request": removed}
        inc = self.db.execute(
            "SELECT id FROM incidents WHERE status != 'resolved' ORDER BY started_at DESC LIMIT 1").fetchone()
        req = await self.create(user, CreateRequest(
            type="grant_role", capability="roles.grant", target_user=username, roles=body.add,
            justification=f"Edit roles · {username} (admin console)", incident_id=inc["id"] if inc else None),
            extra_flags=["admin_role_edit"])
        out = {"code": "quorum_required",
               "message": "No roles changed. TideCloak cannot apply role changes without threshold signatures.",
               "request": req}
        if removed:
            out["applied_removals"] = body.remove
        return 202, out

    async def expire(self, id_: str) -> dict:
        r = self.row(id_)
        if r["status"] != "approved":
            raise ApiError(409, "invalid_state", f"request is {r['status']}, only approved requests expire")
        roles = json.loads(r["roles_json"] or "[]")
        if roles:
            self.gov.revoke_role(r["target_user"], roles)
        ts = now()
        self.db.execute("UPDATE access_requests SET status='expired' WHERE id=?", (id_,))
        self.db.commit()
        r = self.row(id_)
        used = int((ts - parse(r["granted_at"])).total_seconds()) if r["granted_at"] else 0
        await self._audit(actor="system", actor_type="system", action="request.expired",
                          target=f"{r['capability']}:{r['target_user']}", outcome="expired",
                          incident_id=r["incident_id"], request_id=id_, payload={"roles": roles})
        await self._publish_request(r, "request.expired", {
            "id": id_, "expired_at": iso(ts), "capability": r["capability"], "target_user": r["target_user"],
            "actual_use": f"{used // 60}m{used % 60:02d}s"})
        await self._publish_request(r, "request.updated")
        await self._publish_authority(r["target_user"], r["capability"], refresh=True)
        return self.view(r)

    async def expire_due(self, at: datetime | None = None) -> list[str]:
        at = at or now() + timedelta(minutes=getattr(self.app.state, "clock_offset_min", 0))
        due = [r["id"] for r in self.db.execute(
            "SELECT id, expires_at FROM access_requests WHERE status='approved' AND expires_at IS NOT NULL")
            if parse(r["expires_at"]) <= at]
        for id_ in due:
            await self.expire(id_)
        return due

    def notifications(self, username: str) -> dict:
        rows = self.db.execute("SELECT * FROM notifications WHERE user = ? ORDER BY ts DESC, id", (username,)).fetchall()
        groups = []
        for gid, label in GROUPS:
            items = []
            for n in (x for x in rows if x["group_name"] == gid):
                item = {"id": n["id"], "group": gid, "title": n["title"], "body": n["body"],
                        "request_id": n["request_id"]}
                meta = json.loads(n["meta_json"] or "{}")
                r = self.db.execute("SELECT * FROM access_requests WHERE id = ?", (n["request_id"],)).fetchone() \
                    if n["request_id"] else None
                if gid == "approval" and r:
                    item.update(requester=person(r["requester"]), tier=r["tier"],
                                approvals=len(self.approvals(r["id"])), required=r["required"])
                elif r and r["run_id"]:
                    item["run_id"] = r["run_id"]
                item.update(meta)
                item.update(read=bool(n["read"]), ts=n["ts"])
                items.append(item)
            groups.append({"id": gid, "label": label, "items": items})
        return {"unread": sum(1 for n in rows if not n["read"]), "groups": groups}

    def mark_read(self, username: str, id_: str) -> None:
        self.db.execute("UPDATE notifications SET read = 1 WHERE id = ? AND user = ?", (id_, username))
        self.db.commit()
