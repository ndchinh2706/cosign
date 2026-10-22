from fastapi import APIRouter, Depends, Request, Response

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..mocks import load_mock, mount_mocks

router = APIRouter()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "governance_mode": settings.governance_mode,
            "auth_mode": settings.auth_mode, "scan_mode": settings.scan_mode,
            "agent_mode": settings.effective_agent_mode, "version": settings.version}


@router.get("/me")
def me(request: Request, user: User = Depends(current_user)):
    if user.username == "ai-oncall-agent":
        return load_mock(request, "me.json")
    # Other identities: authority derived from the authority-map mock until the policy engine lands.
    identities = load_mock(request, "authority-map.json")["identities"]
    cells = next((i["cells"] for i in identities if i["username"] == user.username), {})
    return {"user": user.public(), "roles": user.roles, "home": user.home,
            "authority": [{"capability": c, "state": s} for c, s in cells.items()],
            "open_requests": 0, "context_flagged": False}


@router.get("/notifications")
def notifications(request: Request, user: User = Depends(current_user)):
    return request.app.state.access.notifications(user.username)


@router.post("/notifications/{id}/read", status_code=204)
def notification_read(id: str, request: Request, user: User = Depends(current_user)):
    request.app.state.access.mark_read(user.username, id)
    return Response(status_code=204)


mount_mocks(router, [])
