from fastapi import APIRouter, Depends, Request, Response

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..insights import Insights
from ..mocks import mount_mocks

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "governance_mode": settings.governance_mode,
            "auth_mode": settings.auth_mode, "scan_mode": settings.scan_mode,
            "agent_mode": settings.effective_agent_mode, "version": settings.version}


@router.get("/me")
async def me(request: Request, user: User = Depends(current_user)):
    await request.app.state.access.expire_due()
    return Insights(request.app).me(user)


@router.get("/notifications")
def notifications(request: Request, user: User = Depends(current_user)):
    return request.app.state.access.notifications(user.username)


@router.post("/notifications/{id}/read", status_code=204)
def notification_read(id: str, request: Request, user: User = Depends(current_user)):
    request.app.state.access.mark_read(user.username, id)
    return Response(status_code=204)


mount_mocks(router, [])
