"""Generic mock layer: serve docs/mocks/*.json per (method, path).

Replace an endpoint with real logic by defining a handler on the same router
*before* `mount_mocks` runs; mounted mocks skip any (method, path) already taken.
"""
import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from .auth import require_roles


@dataclass(frozen=True)
class Mock:
    method: str
    path: str
    file: str | tuple[str, ...] | None = None  # tuple = cycle through on repeated calls
    status: int = 200
    roles: tuple[str, ...] | None = ("*",)  # None = no auth
    body: Any = None  # inline body when there is no mock file


def load_mock(request: Request, name: str) -> Any:
    path = request.app.state.settings.mocks_dir / name
    return json.loads(path.read_text(encoding="utf-8"))


def _handler(spec: Mock):
    calls: dict[str, int] = defaultdict(int)

    async def handler(request: Request):
        if spec.status == 204:
            return Response(status_code=204)
        if spec.file is None:
            data = spec.body if spec.body is not None else {"ok": True}
        elif isinstance(spec.file, tuple):
            key = request.url.path
            data = load_mock(request, spec.file[min(calls[key], len(spec.file) - 1)])
            calls[key] += 1
        else:
            data = load_mock(request, spec.file)
        return JSONResponse(data, status_code=spec.status)

    return handler


def mount_mocks(router: APIRouter, mocks: list[Mock]) -> None:
    taken = {(m, getattr(r, "path", "")) for r in router.routes for m in getattr(r, "methods", ())}
    for spec in mocks:
        if (spec.method, router.prefix + spec.path) in taken:
            continue
        deps = [] if spec.roles is None else [Depends(require_roles(*spec.roles))]
        router.add_api_route(spec.path, _handler(spec), methods=[spec.method],
                             status_code=spec.status, dependencies=deps,
                             name=f"mock {spec.method} {spec.path}", tags=["mock"])
