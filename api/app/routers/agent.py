from fastapi import APIRouter, Body, Depends, Request
from pydantic import BaseModel

from ..auth import User, require_roles
from ..errors import ApiError

router = APIRouter()


class CreateRun(BaseModel):
    incident_id: str
    mode: str | None = None


def svc(request: Request):
    return request.app.state.agents


@router.post("/agent/runs", status_code=201)
async def create_run(body: CreateRun, request: Request,
                     user: User = Depends(require_roles("agent", "oncall", "security"))):
    if body.mode not in (None, "llm", "scripted"):
        raise ApiError(422, "validation_error", "mode must be llm or scripted")
    return await svc(request).create(user, body.incident_id, body.mode)


@router.get("/agent/runs", dependencies=[Depends(require_roles("*"))])
def list_runs(request: Request, incident: str | None = None):
    return svc(request).list(incident)


@router.get("/agent/runs/{id}", dependencies=[Depends(require_roles("*"))])
def get_run(id: str, request: Request):
    return svc(request).get(id)


@router.get("/agent/runs/{id}/summary", dependencies=[Depends(require_roles("*"))])
def run_summary(id: str, request: Request):
    return svc(request).summary(id)


@router.post("/agent/runs/{id}/pause")
async def pause(id: str, request: Request, user: User = Depends(require_roles("oncall", "security"))):
    return await svc(request).pause(user, id)


@router.post("/agent/runs/{id}/resume")
async def resume(id: str, request: Request, user: User = Depends(require_roles("oncall", "security"))):
    return await svc(request).resume(user, id)


@router.post("/agent/runs/{id}/quarantine")
async def quarantine(id: str, request: Request, user: User = Depends(require_roles("security"))):
    return await svc(request).quarantine(user, id)


@router.post("/agent/runs/{id}/tool-result")
def tool_result(id: str, request: Request, payload: dict = Body(...), user: User = Depends(require_roles("agent"))):
    return svc(request).tool_result(user, id, payload)

