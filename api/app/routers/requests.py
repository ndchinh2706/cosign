from fastapi import APIRouter, Depends, Request

from ..auth import User, require_roles
from ..mocks import Mock, load_mock, mount_mocks

router = APIRouter()

READERS = ("oncall", "security", "admin", "compliance", "agent")
APPROVERS = ("oncall", "security", "admin")


@router.post("/requests/{id}/withdraw")
def withdraw(id: str, request: Request, user: User = Depends(require_roles("*"))):
    body = load_mock(request, "request.json")
    return {**body, "id": id, "status": "withdrawn"}


mount_mocks(router, [
    Mock("POST", "/requests", "request-create.json", 201, roles=("agent", "admin", "security")),
    Mock("GET", "/requests", "requests.json", roles=READERS),
    Mock("GET", "/requests/{id}", "request.json", roles=READERS),
    Mock("POST", "/requests/{id}/approve", ("request-approve.json", "request-approve-2.json"), roles=APPROVERS),
    Mock("POST", "/requests/{id}/deny", "request-deny.json", roles=APPROVERS),
])
