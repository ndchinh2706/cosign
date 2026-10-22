from fastapi import APIRouter, Depends, Request

from ..access import ApproveBody, CreateRequest, DenyBody
from ..auth import User, require_roles

router = APIRouter()

READERS = ("oncall", "security", "admin", "compliance", "agent")
APPROVERS = ("oncall", "security", "admin")


@router.post("/requests", status_code=201)
async def create_request(body: CreateRequest, request: Request,
                         user: User = Depends(require_roles("agent", "admin", "security"))):
    return await request.app.state.access.create(user, body)


@router.get("/requests")
async def list_requests(request: Request, status: str | None = None, incident: str | None = None,
                        requester: str | None = None, flagged: bool | None = None,
                        user: User = Depends(require_roles(*READERS))):
    access = request.app.state.access
    await access.expire_due()
    return access.list_requests(user, status, incident, requester, flagged)


@router.get("/requests/{id}")
async def get_request(id: str, request: Request, user: User = Depends(require_roles(*READERS))):
    access = request.app.state.access
    await access.expire_due()
    return access.get(user, id)


@router.post("/requests/{id}/approve")
async def approve(id: str, request: Request, body: ApproveBody | None = None,
                  user: User = Depends(require_roles(*APPROVERS))):
    return await request.app.state.access.approve(user, id, body or ApproveBody())


@router.post("/requests/{id}/deny")
async def deny(id: str, body: DenyBody, request: Request, user: User = Depends(require_roles(*APPROVERS))):
    return await request.app.state.access.deny(user, id, body)


@router.post("/requests/{id}/withdraw")
async def withdraw(id: str, request: Request, user: User = Depends(require_roles("*"))):
    return await request.app.state.access.withdraw(user, id)


