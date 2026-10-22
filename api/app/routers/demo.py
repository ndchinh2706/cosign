from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..errors import ApiError
from ..mocks import Mock, mount_mocks


def demo_gate(user: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> None:
    if settings.auth_mode != "dev" and "security-lead" not in user.roles:
        raise ApiError(403, "forbidden", "demo controls need AUTH_MODE=dev or security-lead")


router = APIRouter(dependencies=[Depends(demo_gate)])

# TODO: wire to seed/DB + WS once real state exists (docs/API.md §5.10).
mount_mocks(router, [
    Mock("POST", "/demo/reset", body={"ok": True, "reset": True}),
    Mock("POST", "/demo/logs/inject", body={"ok": True, "injected_line_id": 125}),
    Mock("POST", "/demo/requests/{id}/expire", body={"ok": True}),
    Mock("POST", "/demo/clock", body={"ok": True}),
])
