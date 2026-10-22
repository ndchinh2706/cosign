import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import payments
from . import seed as seeding
from . import ws
from .access import AccessService
from .agent import AgentService
from .config import Settings, get_settings
from .db import init_db
from .errors import install_error_handlers
from .governance import make_governance
from .routers import admin, agent, audit, core, demo, governance, incidents, records, requests, scan

API_PREFIX = "/api/v1"


async def _expiry_sweeper(app: FastAPI, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await app.state.access.expire_due()
        except Exception:
            pass


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db = init_db(settings.db_path)
        payments.ensure_tables(app.state.db)
        app.state.payments_db = app.state.db
        if hasattr(app.state.governance, "bind_db"):
            app.state.governance.bind_db(app.state.db)
        seeding.seed(app.state.db, settings.mocks_dir, app.state.governance)
        seeding.rehydrate(app.state.db, app.state.governance)
        app.state.access = AccessService(app)
        app.state.agents = AgentService(app)
        sweeper = asyncio.create_task(_expiry_sweeper(app, settings.expiry_sweep_s))
        yield
        await app.state.agents.shutdown()
        sweeper.cancel()
        with suppress(asyncio.CancelledError):
            await sweeper
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
