from fastapi import APIRouter, Depends, Query, Request, Response

from ..access import RolesBody
from ..auth import User, require_roles
from ..insights import Insights
from .audit import list_audit

router = APIRouter()


@router.put("/admin/users/{username}/roles")
async def put_roles(username: str, body: RolesBody, request: Request, response: Response,
                    user: User = Depends(require_roles("admin", "security"))):
    status, out = await request.app.state.access.put_roles(user, username, body)
    response.status_code = status
    return out


@router.get("/admin/users", dependencies=[Depends(require_roles("admin", "security"))])
def admin_users(request: Request):
    return Insights(request.app).admin_users()


@router.get("/admin/data/merchants", dependencies=[Depends(require_roles("admin", "security", "compliance"))])
def merchants(request: Request, limit: int = Query(5, ge=1, le=100)):
    return Insights(request.app).merchants(limit)


@router.post("/admin/data/merchants/export")
async def export_merchants(request: Request, user: User = Depends(require_roles("admin"))):
    return await Insights(request.app).export_merchants(user)


@router.get("/admin/audit", dependencies=[Depends(require_roles("admin"))])
def admin_audit(request: Request, actor_type: str | None = None, incident: str | None = None,
                capability: str | None = None, outcome: str | None = None,
                from_: str | None = Query(None, alias="from"), to: str | None = None,
                limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    return list_audit(request, actor_type, incident, capability, outcome, from_, to, limit, cursor)


@router.delete("/admin/audit/{id}")
async def delete_audit(id: str, request: Request, user: User = Depends(require_roles("admin"))):
    await Insights(request.app).refuse_audit_delete(user, id)
