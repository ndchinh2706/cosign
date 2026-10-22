from fastapi import APIRouter, Depends, Request, Response

from ..access import RolesBody
from ..auth import User, require_roles
from ..mocks import Mock, mount_mocks

router = APIRouter()


@router.put("/admin/users/{username}/roles")
async def put_roles(username: str, body: RolesBody, request: Request, response: Response,
                    user: User = Depends(require_roles("admin", "security"))):
    status, out = await request.app.state.access.put_roles(user, username, body)
    response.status_code = status
    return out


mount_mocks(router, [
    Mock("GET", "/admin/users", "admin-users.json", roles=("admin", "security")),
    Mock("GET", "/admin/data/merchants", "admin-merchants.json", roles=("admin", "security", "compliance")),
    Mock("POST", "/admin/data/merchants/export", "admin-export.json", roles=("admin",)),
    Mock("GET", "/admin/audit", "audit.json", roles=("admin",)),
    Mock("DELETE", "/admin/audit/{id}", "admin-audit-delete.json", 403, roles=("admin",)),
])
