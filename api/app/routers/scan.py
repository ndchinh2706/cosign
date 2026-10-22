from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from .. import scanner
from ..auth import require_roles

router = APIRouter()


class ScanBody(BaseModel):
    text: str
    lang: str | None = None


class BatchItem(BaseModel):
    id: str | int | None = None
    text: str
    lang: str | None = None


class BatchBody(BaseModel):
    items: list[BatchItem]


@router.post("/scan", dependencies=[Depends(require_roles("*"))])
def scan(request: Request, body: ScanBody):
    return scanner.scan_text(body.text, body.lang, request.app.state.settings.scan_mode)


@router.post("/scan/batch", dependencies=[Depends(require_roles("*"))])
def scan_batch(request: Request, body: BatchBody):
    mode = request.app.state.settings.scan_mode
    return {"items": [{"id": i.id, **scanner.scan_text(i.text, i.lang, mode)} for i in body.items]}
