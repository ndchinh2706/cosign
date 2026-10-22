from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import ws
from .config import Settings, get_settings
from .db import init_db
from .errors import install_error_handlers
from .governance import make_governance
from .routers import admin, agent, audit, core, demo, governance, incidents, records, requests, scan

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db = init_db(settings.db_path)
        yield
        app.state.db.close()

    app = FastAPI(title="Cosign API", version=settings.version, lifespan=lifespan)
    app.state.settings = settings
    app.state.hub = ws.Hub()
    app.state.governance = make_governance(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    install_error_handlers(app)
    for r in (core, incidents, agent, requests, records, scan, admin, governance, audit, demo):
        app.include_router(r.router, prefix=API_PREFIX)
    app.include_router(ws.router)
    return app


app = create_app()
