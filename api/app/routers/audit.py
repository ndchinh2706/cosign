from fastapi import APIRouter, Depends, Query, Request

from ..auth import require_roles
from ..insights import Insights

router = APIRouter()

AUDIT_READERS = ("compliance", "security", "admin", "oncall")


def list_audit(request: Request, actor_type, incident, capability, outcome, from_, to, limit, cursor) -> dict:
    f = {"actor_type": actor_type, "incident": incident, "capability": capability, "outcome": outcome,
         "from": from_, "to": to}
    return Insights(request.app).audit_list(f, limit, cursor)


@router.get("/audit", dependencies=[Depends(require_roles(*AUDIT_READERS))])
def audit(request: Request, actor_type: str | None = None, incident: str | None = None,
          capability: str | None = None, outcome: str | None = None, from_: str | None = Query(None, alias="from"),
          to: str | None = None, limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    return list_audit(request, actor_type, incident, capability, outcome, from_, to, limit, cursor)


@router.get("/audit/{id}", dependencies=[Depends(require_roles(*AUDIT_READERS))])
def audit_event(id: str, request: Request):
    return Insights(request.app).audit_get(id)


@router.post("/audit/{id}/verify", dependencies=[Depends(require_roles(*AUDIT_READERS))])
def audit_verify(id: str, request: Request):
    return Insights(request.app).audit_verify(id)
