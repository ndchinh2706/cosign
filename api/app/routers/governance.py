from fastapi import APIRouter, Depends, Request

from ..auth import require_roles
from ..mocks import Mock, load_mock, mount_mocks

router = APIRouter()

GOV_READERS = ("security", "admin", "compliance")


@router.post("/policies/draft", status_code=202, dependencies=[Depends(require_roles("security"))])
def policy_draft(request: Request):
    req = load_mock(request, "request-create.json")
    return {"code": "quorum_required", "message": "Policy changes require T3 quorum.",
            "request": {**req, "type": "policy_change", "capability": "policy.edit", "tier": "T3"}}


mount_mocks(router, [
    Mock("GET", "/governance/overview", "governance-overview.json", roles=GOV_READERS),
    Mock("GET", "/governance/authority-map", "authority-map.json", roles=GOV_READERS),
    Mock("GET", "/policies", "policies.json"),
    Mock("GET", "/policies/versions", "policy-versions.json", roles=("security", "compliance")),
    Mock("GET", "/agents", "agents.json", roles=("security", "oncall")),
    Mock("GET", "/agents/{username}", "agent-detail.json", roles=("security", "oncall")),
    Mock("POST", "/agents/{username}/revoke-all", "agent-revoke-all.json", roles=("security",)),
])
