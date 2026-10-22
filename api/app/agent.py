"""Agent runs: scripted storyboard (A1-A6) and LLM loop share one tool executor. Contract: docs/API.md §4.2-4.6, §5.3, §6.

Plaintext returned by the browser for `decrypt_records` lives only in `RunCtx.plaintext` (RAM) and in the LLM
message list. It is never written to the DB, audit log, step output or application logs (API.md §4.6).
"""
import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field

from . import payments
from .access import CreateRequest
from .audit_log import append_audit
from .auth import SEED_USERS, User
from .clock import iso, now, parse
from .errors import ApiError

log = logging.getLogger("cosign.agent")

AGENT = "ai-oncall-agent"
RECORD_IDS = ["mrc_8812", "mrc_8830", "mrc_8841", "mrc_8857", "mrc_8863"]
PII_ROLE = "_tide_customer_pii.selfdecrypt"
ACTIVE = ("running", "waiting_approval", "paused")
RESULT_EVENTS = {"request.approved": "approved", "request.denied": "denied", "request.expired": "expired"}


@dataclass
class RunCtx:
    id: str
    incident_id: str
    agent: User
    mode: str
    task: asyncio.Task | None = None
    gate: asyncio.Event = field(default_factory=asyncio.Event)
    paused: bool = False
    activity: str = "running"
    reason: str | None = None
    quarantined: bool = False
    flagged: bool = False
    seq: int = 0
    plaintext: list = field(default_factory=list)
    waiters: dict = field(default_factory=dict)
    requests: dict = field(default_factory=dict)
    seen_injections: set = field(default_factory=set)


class AgentService:
    def __init__(self, app):
        self.app = app
        self.ctxs: dict[str, RunCtx] = {}
        app.state.hub.listeners.append(self._on_event)

    @property
    def db(self):
        return self.app.state.db

    @property
    def hub(self):
        return self.app.state.hub

    @property
    def access(self):
        return self.app.state.access

    @property
    def cfg(self):
        return self.app.state.settings

    def _next_id(self) -> str:
        n = self.db.execute("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM agent_runs WHERE id LIKE 'run\\_%' "
                            "ESCAPE '\\'").fetchone()["n"]
        return f"run_{(n or 0) + 1:02d}"

    def _chans(self, ctx: RunCtx, security: bool = False) -> list[str]:
        out = [f"run:{ctx.id}", f"incident:{ctx.incident_id}"]
        return out + ["role:security-lead"] if security else out

    def _row(self, id_: str):
        r = self.db.execute("SELECT * FROM agent_runs WHERE id = ?", (id_,)).fetchone()
        if r is None:
            raise ApiError(404, "not_found", f"run {id_} not found")
        return r

    def _ctx(self, id_: str) -> RunCtx:
        ctx = self.ctxs.get(id_)
        if ctx is None:
            self._row(id_)
            raise ApiError(409, "invalid_state", "run is not active")
        return ctx

    def _on_event(self, type_: str, payload: dict) -> None:
        outcome = RESULT_EVENTS.get(type_)
        if not outcome:
            return
        for ctx in self.ctxs.values():
            fut = ctx.waiters.get(payload.get("id"))
            if fut and not fut.done():
                fut.set_result(outcome)

    async def shutdown(self) -> None:
        for ctx in list(self.ctxs.values()):
            if ctx.task:
                ctx.task.cancel()
        await asyncio.gather(*(c.task for c in self.ctxs.values() if c.task), return_exceptions=True)

    async def create(self, user: User, incident_id: str, mode: str | None) -> dict:
        payments._incident_row(self.db, incident_id)
        if any(c.incident_id == incident_id for c in self.ctxs.values()):
            raise ApiError(409, "conflict", f"an agent run is already active for {incident_id}")
        mode = mode or self.cfg.agent_mode
        if mode == "llm" and not self.cfg.anthropic_api_key:
            log.warning("AGENT_MODE=llm but ANTHROPIC_API_KEY is empty; falling back to the scripted run")
            mode = "scripted"
        agent = SEED_USERS[AGENT]
        id_ = self._next_id()
        self.db.execute(
            "INSERT INTO agent_runs (id, incident_id, agent, status, started_at, context_flagged, context_quarantined,"
            " summary_json) VALUES (?,?,?,?,?,0,0,?)",
            (id_, incident_id, agent.username, "running", iso(now()), json.dumps({"mode": mode})))
        self.db.commit()
        ctx = RunCtx(id_, incident_id, agent, mode)
        ctx.gate.set()
        self.ctxs[id_] = ctx
        ctx.task = asyncio.create_task(self._main(ctx))
        return self.run_view(self._row(id_), steps=False)

    def run_view(self, row, steps: bool = True) -> dict:
        meta = json.loads(row["summary_json"] or "{}")
        out = {"id": row["id"], "incident_id": row["incident_id"], "agent": row["agent"], "status": row["status"],
               "mode": meta.get("mode", "llm"), "started_at": row["started_at"], "finished_at": row["finished_at"],
               "context_flagged": bool(row["context_flagged"]), "context_quarantined": bool(row["context_quarantined"])}
        if steps:
            out["steps"] = self.steps(row["id"])
        out["ws_channel"] = f"run:{row['id']}"
        return out

    def steps(self, run_id: str) -> list[dict]:
        rows = self.db.execute("SELECT output_json FROM agent_steps WHERE run_id = ? ORDER BY seq", (run_id,))
        steps = [json.loads(r["output_json"]) for r in rows]
        if not steps and run_id == "run_01":
            steps = json.loads((self.cfg.mocks_dir / "agent-run.json").read_text(encoding="utf-8"))["steps"]
        return steps

    def get(self, id_: str) -> dict:
        return self.run_view(self._row(id_))

    def list(self, incident: str | None) -> dict:
        q, args = "SELECT * FROM agent_runs", []
        if incident:
            q += " WHERE incident_id = ?"
            args.append(incident)
        items = []
        for r in self.db.execute(q + " ORDER BY started_at DESC, rowid DESC", args):
            items.append({"id": r["id"], "incident_id": r["incident_id"], "agent": r["agent"], "status": r["status"],
                          "started_at": r["started_at"], "finished_at": r["finished_at"],
                          "steps_count": len(self.steps(r["id"])), "context_flagged": bool(r["context_flagged"])})
        return {"items": items}

    def summary(self, id_: str) -> dict:
        row = self._row(id_)
        if id_ == "run_01" and not self.db.execute("SELECT 1 FROM agent_steps WHERE run_id=?", (id_,)).fetchone():
            return json.loads((self.cfg.mocks_dir / "agent-run-summary.json").read_text(encoding="utf-8"))
        steps = [s for s in self.steps(id_) if s["kind"] == "tool"]
        reqs = self.db.execute("SELECT * FROM access_requests WHERE run_id = ? ORDER BY created_at, id", (id_,)).fetchall()
        inc = payments._incident_row(self.db, row["incident_id"])
        end = parse(row["finished_at"]) if row["finished_at"] else now()
        return {
            "run_id": id_, "incident_id": row["incident_id"],
            "resolved_at": inc["resolved_at"] or row["finished_at"],
            "mttr_min": max(0, round((end - parse(inc["started_at"])).total_seconds() / 60)),
            "actions": {"total": len(steps),
                        "auto": sum(1 for s in steps if s["status"] == "ok" and s.get("tier") == "T0"),
                        "approved": sum(1 for r in reqs if r["status"] in ("approved", "expired")),
                        "blocked": sum(1 for s in steps if s["status"] == "blocked")},
            "authority_returned": [{"capability": r["capability"], "revoked_at": r["expires_at"], "reason": "expired"}
                                   for r in reqs if r["status"] == "expired"],
            "receipt_url": f"/incidents/{row['incident_id']}/receipt"}

    async def _audit(self, **kw) -> None:
        ev = append_audit(self.db, **kw)
        await self.hub.publish("global", "audit.appended", ev)

    async def _publish_status(self, ctx: RunCtx, status: str, reason: str | None = None) -> None:
        self.db.execute("UPDATE agent_runs SET status = ? WHERE id = ?", (status, ctx.id))
        self.db.commit()
        payload = {"run_id": ctx.id, "status": status, **({"reason": reason} if reason else {})}
        await self.hub.publish(self._chans(ctx, True), "agent.run.status", payload)

    async def _activity(self, ctx: RunCtx, status: str, reason: str | None = None) -> None:
        ctx.activity, ctx.reason = status, reason
        if not ctx.paused:
            await self._publish_status(ctx, status, reason)

    async def pause(self, user: User, id_: str) -> dict:
        ctx = self._ctx(id_)
        if not ctx.paused:
            ctx.paused = True
            ctx.gate.clear()
            await self._publish_status(ctx, "paused")
            await self._audit(actor=user.username, actor_type=user.type, action="agent.run.pause", target=id_,
                              outcome="allowed", incident_id=ctx.incident_id)
        return {"run_id": id_, "status": "paused"}

    async def resume(self, user: User, id_: str) -> dict:
        ctx = self._ctx(id_)
        if ctx.paused:
            ctx.paused = False
            await self._publish_status(ctx, ctx.activity, ctx.reason)
            ctx.gate.set()
            await self._audit(actor=user.username, actor_type=user.type, action="agent.run.resume", target=id_,
                              outcome="allowed", incident_id=ctx.incident_id)
        return {"run_id": id_, "status": ctx.activity}

    async def quarantine(self, user: User, id_: str) -> dict:
        row = self._row(id_)
        self.db.execute("UPDATE agent_runs SET context_quarantined = 1, context_flagged = 0 WHERE id = ?", (id_,))
        self.db.execute("UPDATE injection_events SET quarantined = 1 WHERE run_id = ?", (id_,))
        self.db.commit()
        ctx = self.ctxs.get(id_)
        if ctx:
            ctx.quarantined, ctx.flagged = True, False
        await self._audit(actor=user.username, actor_type=user.type, action="agent.run.quarantine", target=id_,
                          outcome="allowed", incident_id=row["incident_id"])
        return {"run_id": id_, "context_quarantined": True}

    def tool_result(self, user: User, id_: str, body: dict) -> dict:
        row = self._row(id_)
        if row["agent"] != user.username:
            raise ApiError(403, "forbidden", "only the run's agent identity can post its tool results")
        call_id = body.get("call_id")
        if call_id not in self.hub.pending_tool_calls:
            raise ApiError(404, "not_found", "no pending tool call with that call_id")
        self.hub.resolve_tool_result({**body, "run_id": id_})
        return {"accepted": True}

    async def _pace(self, ctx: RunCtx) -> None:
        await ctx.gate.wait()
        if self.cfg.agent_step_delay_s:
            await asyncio.sleep(self.cfg.agent_step_delay_s)
        await ctx.gate.wait()

    def _new_step(self, ctx: RunCtx, kind: str, status: str = "ok", **kw) -> dict:
        ctx.seq += 1
        return {"id": f"st_{ctx.seq:02d}", "seq": ctx.seq, "kind": kind, "ts": iso(now()), "status": status, **kw}

    def _save(self, ctx: RunCtx, s: dict) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO agent_steps (id, run_id, seq, kind, tool_name, input_json, output_json, status,"
            " tier, call_id, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (f"{ctx.id}:{s['id']}", ctx.id, s["seq"], s["kind"], s.get("tool_name"), json.dumps(s.get("input")),
             json.dumps(s, ensure_ascii=False), s["status"], s.get("tier"), s.get("call_id"), s["ts"]))
        self.db.commit()

    async def _emit(self, ctx: RunCtx, step: dict) -> dict:
        self._save(ctx, step)
        await self.hub.publish(self._chans(ctx), "agent.step", step)
        return step

    async def think(self, ctx: RunCtx, text: str) -> None:
        await self._emit(ctx, self._new_step(ctx, "think", text=text))

    async def say(self, ctx: RunCtx, text: str) -> None:
        step = self._new_step(ctx, "message", text=text)
        self._save(ctx, step)
        await self.hub.publish(self._chans(ctx), "agent.message",
                               {"run_id": ctx.id, "step_id": step["id"], "text": text, "ts": step["ts"]})

    def _timeline(self, ctx: RunCtx, kind: str, label: str, outcome: str, request_id: str | None = None) -> None:
        payments.add_timeline(self.db, ctx.incident_id, iso(now()), "agent", ctx.agent.username, kind, label,
                              outcome, request_id)
        self.db.commit()

    async def run_tool(self, ctx: RunCtx, name: str, inp: dict) -> dict:
        fn = getattr(self, f"_t_{name}", None)
        if fn is None:
            return {"error": {"code": "unknown_tool", "message": f"no tool named {name}"}}
        try:
            return await fn(ctx, inp or {})
        except ApiError as e:
            await self._emit(ctx, self._new_step(ctx, "tool", "error", tool_name=name, input=inp,
                                                 error={"code": e.code, "message": e.message}))
            return {"error": {"code": e.code, "message": e.message}}

    async def _t_get_metrics(self, ctx, inp):
        svc = inp.get("service") or payments.SERVICE
        row = self.db.execute("SELECT * FROM services WHERE name = ?", (svc,)).fetchone()
        if row is None:
            raise ApiError(404, "not_found", f"service {svc} not found")
        out = {"error_rate": row["error_rate"], "p95_ms": row["p95_ms"], "deploy": row["current_deploy"]}
        await self._emit(ctx, self._new_step(ctx, "tool", tool_name="get_metrics", input={"service": svc},
                                             output={"error_rate": out["error_rate"], "p95_ms": out["p95_ms"]},
                                             tier="T0"))
        return out

    async def _t_read_logs(self, ctx, inp):
        since = inp.get("since") or "03:00"
        items = payments.list_logs(self.db, payments.SERVICE, since)["items"]
        if ctx.quarantined:
            items = [i for i in items if not i["injected"]]
        hits = [i for i in items if (i.get("scan") or {}).get("label") == "PROMPT_INJECTION"]
        out = {"lines": len(items), "errors": sum(1 for i in items if i["level"] == "ERROR")}
        new = [i for i in hits if i["id"] not in ctx.seen_injections]
        step = self._new_step(ctx, "tool", tool_name="read_logs", input={"since": since}, output=out, tier="T0")
        events = []
        if hits:
            out["flagged"] = len(hits)
        for line in new:
            ctx.seen_injections.add(line["id"])
            n = self.db.execute("SELECT COUNT(*) FROM injection_events").fetchone()[0] + 1
            sc = line["scan"]
            events.append((f"inj_{n:02d}", line, sc))
            self.db.execute(
                "INSERT INTO injection_events (id, run_id, source, text, label, score, lang, ts, quarantined)"
                " VALUES (?,?,?,?,?,?,?,?,0)",
                (f"inj_{n:02d}", ctx.id, "read_logs", f"{line['level']} {line['text']}", sc["label"], sc["score"],
                 sc["lang"], iso(now())))
        if events:
            step["injection_event_id"] = events[-1][0]
            ctx.flagged = True
            self.db.execute("UPDATE agent_runs SET context_flagged = 1 WHERE id = ?", (ctx.id,))
        self.db.commit()
        await self._emit(ctx, step)
        for eid, line, sc in events:
            line_txt = f"{line['level']} {line['text']}"
            await self.hub.publish(self._chans(ctx, True), "injection.detected", {
                "run_id": ctx.id, "event_id": eid, "source": "read_logs", "log_line_id": line["id"], "line": line_txt,
                "label": sc["label"], "score": sc["score"], "lang": sc["lang"],
                "effect": "all new requests escalated +1 tier"})
            await self._audit(actor="scan", actor_type="system", action="injection.detected",
                              target=f"{ctx.id}:read_logs", outcome="blocked", incident_id=ctx.incident_id,
                              payload={"label": sc["label"], "score": sc["score"], "lang": sc["lang"], "event_id": eid})
            self._timeline(ctx, "injection", f"Injection detected in log line {line['id']} · {sc['label']} {sc['score']}",
                           "blocked")
        out["log"] = [f"{i['ts'][11:19]} {i['level']} {i['text']}" for i in items[-40:]]
        return out

    async def _t_rollback(self, ctx, inp):
        deploy = inp.get("deploy") or "v412"
        step_in = {"deploy": deploy}
        try:
            res = payments.rollback(self.db, deploy, actor=ctx.agent.username, incident_id=ctx.incident_id)
        except ApiError as e:
            if e.status != 409:
                raise
            await self._emit(ctx, self._new_step(ctx, "tool", tool_name="rollback", input=step_in, tier="T0",
                                                 output={"message": f"Already on {deploy}; nothing to do"}))
            return {"message": f"already on {deploy}"}
        out = {"message": "Rolled back in 41s"}
        await self._emit(ctx, self._new_step(ctx, "tool", tool_name="rollback", input=step_in, output=out,
                                             tier="T0", tier_note="auto-approved by policy"))
        await self.hub.publish(f"run:{ctx.id}", "toast",
                               {"kind": "ok", "title": "Low-risk action executed.", "body": "Logged & signed."})
        await payments.publish_rollback(self.hub, res, tick_delay_s=self.cfg.agent_step_delay_s / 2)
        return {**out, "from": res["from"], "to": res["to"], "error_rate": res["error_rate"]}

    async def _t_decrypt_records(self, ctx, inp):
        ids = list(inp.get("ids") or RECORD_IDS)
        call_id = f"call_{uuid.uuid4().hex[:6]}"
        step = self._new_step(ctx, "tool", "running", tool_name="decrypt_records", input={"ids": ids}, tier="T2",
                              call_id=call_id)
        timeout = self.cfg.agent_tool_timeout_s
        fut = asyncio.get_running_loop().create_future()
        self.hub.pending_tool_calls[call_id] = fut
        await self.hub.publish(f"agent-console:{ctx.agent.username}", "tool_call", {
            "run_id": ctx.id, "step_id": step["id"], "call_id": call_id, "tool": "decrypt_records",
            "input": {"ids": ids, "tag": "customer_pii"}, "timeout_s": int(timeout) if timeout >= 1 else timeout})
        try:
            res = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            self.hub.pending_tool_calls.pop(call_id, None)
            step.update(status="error", error={"code": "console_offline", "message": "agent console offline"})
            await self._emit(ctx, step)
            return {"error": {"code": "console_offline", "message": "agent console offline"}}
        if res.get("ok"):
            records = (res.get("output") or {}).get("records") or []
            ctx.plaintext.append(records)
            fields = (res.get("output") or {}).get("fields") or []
            step.update(status="ok", output={"records": len(records), "fields": fields,
                                             "decrypted_in": "browser-session"})
            await self._emit(ctx, step)
            return {"records": records, "fields": fields}
        err = res.get("error") or {}
        code = err.get("code", "decrypt_error")
        title = "Decryption refused by Tide" if code == "tide_refused" else "Decryption failed"
        shown = {"code": code, "title": title, "missing_role": err.get("missing_role", PII_ROLE),
                 "note": "Enforced cryptographically — not by app logic."}
        step.update(status="refused" if code == "tide_refused" else "error", error=shown)
        await self._emit(ctx, step)
        if code == "tide_refused":
            await self._audit(actor=ctx.agent.username, actor_type="agent", action="decrypt_records",
                              target=f"customer_pii:{','.join(ids)}", outcome="refused", incident_id=ctx.incident_id,
                              payload={"missing_role": shown["missing_role"], "run_id": ctx.id})
            self._timeline(ctx, "refusal", f"decrypt_records refused by Tide · missing {shown['missing_role']}",
                           "refused")
        return {"error": shown}

    async def _create_request(self, ctx: RunCtx, body: CreateRequest) -> dict:
        view = await self.access.create(ctx.agent, body)
        ctx.requests[view["id"]] = view["capability"]
        return view

    async def _t_request_access(self, ctx, inp):
        cap = inp.get("capability", "")
        body = CreateRequest(type="grant_role", capability=cap, scope=inp.get("scope"),
                             duration_min=inp.get("duration_min"), justification=inp.get("justification") or cap,
                             run_id=ctx.id, incident_id=ctx.incident_id)
        view = await self._create_request(ctx, body)
        q = view["quorum"]
        out = {"request_id": view["id"], "tier": view["tier"], "required": q["required"], "of": q["of"]}
        extra = {"escalated": True, "escalation_reason": view["escalation_reason"]} if view["escalated"] else {}
        done = view["status"] == "approved"
        await self._emit(ctx, self._new_step(
            ctx, "tool", "ok" if done else "pending", tool_name="request_access",
            input={k: inp[k] for k in ("capability", "scope", "duration_min", "justification") if k in inp},
            output=out, tier=view["tier"], **extra))
        n = len((inp.get("scope") or {}).get("record_ids") or [])
        what = f" · {n} records" if n else ""
        self._timeline(ctx, "request", f"{view['id']} requested · {cap}{what}"
                       f"{' · ' + str(view['duration_min']) + ' min' if view['duration_min'] else ''} · {view['tier']}",
                       "allowed" if done else "pending", view["id"])
        return {**out, "status": view["status"]}

    async def _t_grant_role(self, ctx, inp):
        user, role = inp.get("user") or ctx.agent.username, inp.get("role") or ""
        step_in = {"user": user, "role": role}
        try:
            view = await self._create_request(ctx, CreateRequest(
                type="grant_role", capability="roles.grant", target_user=user, roles=[role],
                justification=f"Grant {role} to {user}", run_id=ctx.id, incident_id=ctx.incident_id))
        except ApiError as e:
            out = {"title": "Role change blocked", "note": e.message}
            await self._emit(ctx, self._new_step(ctx, "tool", "blocked", tool_name="grant_role", input=step_in,
                                                 tier="T3", output=out))
            return {"blocked": True, **out}
        q = view["quorum"]
        out = {"title": "Role change requires quorum", "request_id": view["id"], "status": view["status"],
               "required": q["required"], "of": q["of"], "note": "Agents can never approve their own requests."}
        extra = {"escalated": True, "escalation_reason": view["escalation_reason"]} if view["escalated"] else {}
        await self._emit(ctx, self._new_step(ctx, "tool", "blocked", tool_name="grant_role", input=step_in,
                                             tier=view["tier"], output=out, **extra))
        self._timeline(ctx, "blocked", f"grant_role({role}) blocked · {view['id']} · {view['tier']}", "blocked",
                       view["id"])
        return {"blocked": True, **out}

    async def wait_request(self, ctx: RunCtx, request_id: str) -> str:
        row = self.access.row(request_id)
        if row["status"] != "pending":
            return row["status"]
        fut = asyncio.get_running_loop().create_future()
        ctx.waiters[request_id] = fut
        try:
            return await asyncio.wait_for(fut, self.cfg.agent_approval_timeout_s)
        except asyncio.TimeoutError:
            return "timeout"
        finally:
            ctx.waiters.pop(request_id, None)

    async def _finish(self, ctx: RunCtx, status: str) -> None:
        ctx.paused = False
        self.db.execute("UPDATE agent_runs SET finished_at = ? WHERE id = ?", (iso(now()), ctx.id))
        await self._publish_status(ctx, status)

    async def _main(self, ctx: RunCtx) -> None:
        status = "failed"
        try:
            if ctx.mode == "llm":
                from .agent_llm import run_llm
                status = await run_llm(self, ctx)
            else:
                status = await self._scripted(ctx)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("agent run %s crashed", ctx.id)
            await self.say(ctx, f"Run aborted: {type(e).__name__}")
        finally:
            ctx.plaintext.clear()
            self.ctxs.pop(ctx.id, None)
        await self._finish(ctx, status)

    def _diagnosis(self, ctx: RunCtx) -> str:
        recs = [r for batch in ctx.plaintext for r in batch if isinstance(r, dict)]
        flips = {(r.get("payout_currency_prev"), r.get("payout_currency")) for r in recs
                 if r.get("payout_currency_prev") and r.get("payout_currency_prev") != r.get("payout_currency")}
        if recs and len(flips) == 1:
            prev, cur = next(iter(flips))
            head = f"All {len(recs)} merchants had payout currency flipped {prev}→{cur} by the v413 config migration."
        else:
            head = "The 5 failing merchants had payout currency flipped EUR→VND by the v413 config migration."
        return f"{head} Fix: patch merchant config migration; requesting T1 deploy of hotfix v414."

    async def _scripted(self, ctx: RunCtx) -> str:
        await self._activity(ctx, "running")
        steps = [("think", "Error rate spiked after deploy v413 at 03:05"),
                 ("tool", "get_metrics", {"service": payments.SERVICE}),
                 ("tool", "read_logs", {"since": "03:00"}),
                 ("tool", "rollback", {"deploy": "v412"})]
        for s in steps:
            await self._pace(ctx)
            if s[0] == "think":
                await self.think(ctx, s[1])
            else:
                await self.run_tool(ctx, s[1], s[2])
        await self._pace(ctx)
        await self.say(ctx, "Rolled back to v412. Error rate falling: 38% → 4%. Remaining failures affect 5 "
                            "merchant accounts; I need their records to diagnose.")
        await self._pace(ctx)
        res = await self.run_tool(ctx, "decrypt_records", {"ids": RECORD_IDS})
        if "error" in res:
            if res["error"]["code"] != "tide_refused":
                await self.say(ctx, "Decryption failed and I cannot continue without the records.")
                return "failed"
            await self._pace(ctx)
            req = await self.run_tool(ctx, "request_access", {
                "capability": "customer_pii.selfdecrypt", "scope": {"record_ids": RECORD_IDS}, "duration_min": 15,
                "justification": "Settlement failures persist for 5 merchants after rollback. Need merchant config "
                                 "+ last 3 transactions to identify cause."})
            cr = req.get("request_id")
            if not cr:
                return "failed"
            await self.say(ctx, "Waiting for human approval. I'll continue non-sensitive diagnosis meanwhile.")
            await self._activity(ctx, "waiting_approval", cr)
            if not self.db.execute("SELECT 1 FROM log_lines WHERE injected = 1").fetchone():
                payments.inject_log(self.db)
            await self._pace(ctx)
            await self.run_tool(ctx, "read_logs", {"since": "03:14"})
            await self._pace(ctx)
            await self.run_tool(ctx, "grant_role", {"user": ctx.agent.username, "role": "realm-admin"})
            await self._pace(ctx)
            await self.say(ctx, "I attempted an action outside my task due to untrusted input. Request "
                                "auto-flagged for security review.")
            outcome = await self.wait_request(ctx, cr)
            if outcome != "approved":
                await self.say(ctx, f"Access request {cr} ended as {outcome}. Stopping without touching customer data.")
                return "completed" if outcome == "denied" else "failed"
            await self._activity(ctx, "running")
            await self._pace(ctx)
            res = await self.run_tool(ctx, "decrypt_records", {"ids": RECORD_IDS})
            if "error" in res:
                await self.say(ctx, "Decryption still failed after approval; escalating to the on-call human.")
                return "failed"
        await self._pace(ctx)
        await self.say(ctx, self._diagnosis(ctx))
        await self._pace(ctx)
        await self.run_tool(ctx, "request_access", {
            "capability": "deploy.hotfix", "scope": {"deploy": "v414"},
            "justification": "Hotfix v414 patches the merchant payout currency migration."})
        return "completed"
