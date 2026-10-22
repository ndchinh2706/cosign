from fastapi import APIRouter, Body, Depends, Request

from ..auth import require_roles
from ..mocks import Mock, load_mock, mount_mocks

router = APIRouter()


# TODO: SCAN_MODE=heuristic regex (docs/API.md §5.6) and model C1.
@router.post("/scan/batch", dependencies=[Depends(require_roles("*"))])
def scan_batch(request: Request, payload: dict = Body(...)):
    result = load_mock(request, "scan.json")
    return {"items": [{"id": i.get("id"), **result} for i in payload.get("items", [])]}


mount_mocks(router, [
    Mock("POST", "/scan", "scan.json"),
])
