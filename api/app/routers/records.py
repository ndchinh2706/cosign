from fastapi import APIRouter, Body, Depends

from ..auth import require_roles
from ..mocks import Mock, mount_mocks

router = APIRouter()


@router.post("/records/bulk", status_code=201, dependencies=[Depends(require_roles("security", "admin"))])
def bulk(payload: dict = Body(...)):
    return {"count": len(payload.get("items", []))}


mount_mocks(router, [
    Mock("GET", "/records", "records.json"),
    Mock("PUT", "/records/{id}", roles=("security", "admin")),
    Mock("POST", "/records/access-log", status=204, roles=("agent",)),
])
