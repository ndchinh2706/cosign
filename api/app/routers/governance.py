from fastapi import APIRouter, Body, Depends, Request

from ..auth import User, current_user, require_roles
from ..insights import Insights
from ..policy import Policy

router = APIRouter()

GOV_READERS = ("security", "admin", "compliance")


@router.post("/policies/draft", status_code=202)
async def policy_draft(request: Request, draft: dict = Body(...), user: User = Depends(require_roles("security"))):
    return await Insights(request.app).policy_draft(user, draft)


@router.get("/policies")
def policies(request: Request, user: User = Depends(current_user)):
    return Policy.load(request.app.state.db).body


@router.get("/policies/versions", dependencies=[Depends(require_roles("security", "compliance"))])
def policy_versions(request: Request):
    return Insights(request.app).policy_versions()


@router.get("/governance/overview", dependencies=[Depends(require_roles(*GOV_READERS))])
async def overview(request: Request):
    await request.app.state.access.expire_due()
    return Insights(request.app).overview()


@router.get("/governance/authority-map", dependencies=[Depends(require_roles(*GOV_READERS))])
async def authority_map(request: Request):
    await request.app.state.access.expire_due()
    return Insights(request.app).authority_map()


@router.get("/agents", dependencies=[Depends(require_roles("security", "oncall"))])
async def agents(request: Request):
    await request.app.state.access.expire_due()
    return Insights(request.app).agents()


@router.get("/agents/{username}", dependencies=[Depends(require_roles("security", "oncall"))])
async def agent_detail(username: str, request: Request):
    await request.app.state.access.expire_due()
    return Insights(request.app).agent_detail(username)


@router.post("/agents/{username}/revoke-all")
async def revoke_all(username: str, request: Request, user: User = Depends(require_roles("security"))):
    return await Insights(request.app).revoke_all(user, username)
