from fastapi import APIRouter, Body, Depends, Request

from .. import payments
from ..auth import User, current_user
from ..config import Settings, get_settings
from ..errors import ApiError
from ..governance import make_governance
from ..mocks import Mock, mount_mocks


def demo_gate(user: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> None:
    if settings.auth_mode != "dev" and "security-lead" not in user.roles:
        raise ApiError(403, "forbidden", "demo controls need AUTH_MODE=dev or security-lead")


router = APIRouter(dependencies=[Depends(demo_gate)])


@router.post("/demo/reset")
async def reset(request: Request, payload: dict | None = Body(default=None), db=Depends(payments.get_db)):
    wipe = bool((payload or {}).get("wipe_records", False))
    payments.reset(db, wipe_records=wipe)
    app = request.app
    app.state.governance = make_governance(app.state.settings)
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


# TODO #8/#7: /demo/requests/{id}/expire belongs with the requests lifecycle.
mount_mocks(router, [
    Mock("POST", "/demo/requests/{id}/expire", body={"ok": True}),
])
