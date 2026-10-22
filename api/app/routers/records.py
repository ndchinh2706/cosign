import re
from datetime import datetime

from fastapi import APIRouter, Body, Depends, Query, Request, Response

from .. import payments
from ..audit_log import append_audit
from ..auth import User, require_roles
from ..errors import ApiError
from ..ws import TZ

router = APIRouter()

ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
TAG_RE = re.compile(r"^[a-z0-9_.-]{1,64}$")
FIELD_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
# Opaque encoded string (base64 / base64url / hex). Spaces, quotes or braces mean readable data was sent.
CIPHERTEXT_RE = re.compile(r"^[A-Za-z0-9+/=_.:~-]{16,65536}$")
PLAINTEXT_HINTS = {"plaintext", "plain", "name", "tax_id", "settlement_bank", "payout_currency", "last_tx",
                   "value", "values", "data"}
RECORD_KEYS = {"id", "tag", "ciphertext"}


def _reject_extra(obj: dict, allowed: set[str], where: str) -> None:
    extra = sorted(set(obj) - allowed)
    if extra:
        code = "plaintext_rejected" if PLAINTEXT_HINTS & set(extra) else "validation_error"
        raise ApiError(422, code, f"{where}: unexpected field(s) {extra}; the server stores ciphertext and tag only")


def _clean(item: object, *, with_id: bool, where: str) -> dict:
    if not isinstance(item, dict):
        raise ApiError(422, "validation_error", f"{where}: object expected")
    _reject_extra(item, RECORD_KEYS if with_id else RECORD_KEYS - {"id"}, where)
    if with_id and not (isinstance(item.get("id"), str) and ID_RE.match(item["id"])):
        raise ApiError(422, "validation_error", f"{where}: invalid id")
    if not (isinstance(item.get("tag"), str) and TAG_RE.match(item["tag"])):
        raise ApiError(422, "validation_error", f"{where}: invalid tag")
    if not (isinstance(item.get("ciphertext"), str) and CIPHERTEXT_RE.match(item["ciphertext"])):
        raise ApiError(422, "plaintext_rejected", f"{where}: ciphertext must be an opaque encoded string")
    return item


def _upsert(db, rid: str, item: dict, user: User) -> dict:
    now = datetime.now(TZ).isoformat(timespec="seconds")
    db.execute("INSERT INTO merchant_records (id, tag, ciphertext, encrypted_by, encrypted_at) VALUES (?,?,?,?,?)"
               " ON CONFLICT(id) DO UPDATE SET tag=excluded.tag, ciphertext=excluded.ciphertext,"
               " encrypted_by=excluded.encrypted_by, encrypted_at=excluded.encrypted_at",
               (rid, item["tag"], item["ciphertext"], user.username, now))
    return {"id": rid, "tag": item["tag"], "ciphertext": item["ciphertext"],
            "encrypted_by": user.username, "encrypted_at": now}


@router.get("/records", dependencies=[Depends(require_roles("*"))])
def get_records(ids: str | None = Query(default=None), db=Depends(payments.get_db)):
    sql, args = "SELECT id, tag, ciphertext, encrypted_by, encrypted_at FROM merchant_records", []
    if ids is not None:
        args = [i for i in ids.split(",") if i]
        sql += f" WHERE id IN ({','.join('?' * len(args))})"
    return {"items": [dict(r) for r in db.execute(sql + " ORDER BY id", args)]}


@router.put("/records/{id}")
def put_record(id: str, payload: dict = Body(...), user: User = Depends(require_roles("security", "admin")),
               db=Depends(payments.get_db)):
    if not ID_RE.match(id):
        raise ApiError(422, "validation_error", "invalid id")
    rec = _upsert(db, id, _clean(payload, with_id=False, where="body"), user)
    db.commit()
    return rec


@router.post("/records/bulk", status_code=201)
def bulk(payload: dict = Body(...), user: User = Depends(require_roles("security", "admin")),
         db=Depends(payments.get_db)):
    _reject_extra(payload, {"items"}, "body")
    items = payload.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 500:
        raise ApiError(422, "validation_error", "items must be a list of 1..500 entries")
    cleaned = [_clean(it, with_id=True, where=f"items[{n}]") for n, it in enumerate(items)]
    for it in cleaned:
        _upsert(db, it["id"], it, user)
    db.commit()
    return {"count": len(cleaned)}


@router.post("/records/access-log", status_code=204)
async def access_log(request: Request, payload: dict = Body(...), user: User = Depends(require_roles("agent")),
                     db=Depends(payments.get_db)):
    _reject_extra(payload, {"run_id", "record_ids", "fields"}, "body")
    run_id, ids, fields = payload.get("run_id"), payload.get("record_ids"), payload.get("fields")
    if not (isinstance(run_id, str) and ID_RE.match(run_id)):
        raise ApiError(422, "validation_error", "run_id required")
    if not (isinstance(ids, list) and ids and all(isinstance(i, str) and ID_RE.match(i) for i in ids)):
        raise ApiError(422, "validation_error", "record_ids must be a non-empty list of ids")
    if not (isinstance(fields, list) and all(isinstance(f, str) and FIELD_RE.match(f) for f in fields)):
        raise ApiError(422, "validation_error", "fields must be a list of field names, not values")
    run = db.execute("SELECT incident_id FROM agent_runs WHERE id=?", (run_id,)).fetchone()
    tags = {r["tag"] for r in db.execute(
        f"SELECT tag FROM merchant_records WHERE id IN ({','.join('?' * len(ids))})", ids)}
    event = append_audit(db, actor=user.username, actor_type=user.type, action="data.accessed",
                         target=f"{next(iter(tags)) if len(tags) == 1 else 'records'}:{','.join(ids)}",
                         outcome="allowed", incident_id=run["incident_id"] if run else None,
                         payload={"run_id": run_id, "record_ids": ids, "fields": fields})
    await request.app.state.hub.publish("global", "audit.appended", event)
    return Response(status_code=204)
