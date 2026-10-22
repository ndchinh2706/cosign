from fastapi import APIRouter, Body, Depends, Request

from .. import payments
from ..auth import User, current_user
from ..config import Settings, get_settings
from ..errors import ApiError
from .. import seed as seeding
from ..governance import seed_roles


def demo_gate(user: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> None:
    if settings.auth_mode != "dev" and "security-lead" not in user.roles:
        raise ApiError(403, "forbidden", "demo controls need AUTH_MODE=dev or security-lead")


router = APIRouter(dependencies=[Depends(demo_gate)])


@router.post("/demo/reset")
async def reset(request: Request, payload: dict | None = Body(default=None), db=Depends(payments.get_db)):
    wipe = bool((payload or {}).get("wipe_records", False))
    payments.reset(db, wipe_records=wipe)
    app = request.app
    seeding.reset(db, app.state.settings.mocks_dir, app.state.governance, seed_roles(), records=not wipe and app.state.settings.seed_sample_records)
    app.state.clock_offset_min = 0
    row = payments.list_incidents(db)["items"][0]
    await app.state.hub.publish(f"incident:{payments.INCIDENT_ID}", "incident.updated",
                                {"id": row["id"], "status": row["status"], "error_rate": row["error_rate"],
                                 "resolved_at": row["resolved_at"]})
    return {"ok": True, "reset": True, "wipe_records": wipe}


@router.post("/demo/logs/inject")
def inject_log(db=Depends(payments.get_db)):
    return payments.inject_log(db)


@router.post("/demo/clock")
def clock(request: Request, payload: dict = Body(...)):
    offset = payload.get("offset_min")
    if not isinstance(offset, int) or isinstance(offset, bool):
        raise ApiError(422, "validation_error", "offset_min must be an integer")
    request.app.state.clock_offset_min = offset
    return {"ok": True, "offset_min": offset}


@router.post("/demo/requests/{id}/expire")
async def demo_expire(id: str, request: Request):
    await request.app.state.access.expire(id)
    return {"ok": True}
