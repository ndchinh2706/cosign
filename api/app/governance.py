from dataclasses import dataclass
from typing import Literal, Protocol

from .config import Settings

CRStatus = Literal["pending", "approved", "denied", "committed"]


@dataclass
class ApprovalResult:
    approvals: int
    required: int
    committed: bool
    signature: str | None = None
    ork_nodes: str | None = None


class TideGovernance(Protocol):
    def propose_role_change(self, target_user: str, add: list[str], remove: list[str],
                            reason: str, meta: dict) -> str: ...
    def approve(self, tide_cr_id: str, approver: str) -> ApprovalResult: ...
    def status(self, tide_cr_id: str) -> CRStatus: ...
    def revoke_role(self, target_user: str, roles: list[str]) -> None: ...
    def user_roles(self, username: str) -> list[str]: ...


class MockTideGovernance:
    """In-memory stand-in; fake `sig:` values, ORK "14/20". See docs/API.md §7."""

    def __init__(self, seed_roles: dict[str, list[str]]):
        self._roles = {u: list(r) for u, r in seed_roles.items()}
        self._crs: dict[str, dict] = {}

    def propose_role_change(self, target_user, add, remove, reason, meta):
        cr_id = f"mock-cr-{len(self._crs) + 1:04d}"
        self._crs[cr_id] = {"target": target_user, "add": add, "remove": remove,
                            "required": meta.get("required", 2), "approvers": [], "status": "pending"}
        return cr_id

    def approve(self, tide_cr_id, approver):
        cr = self._crs[tide_cr_id]
        if approver not in cr["approvers"]:
            cr["approvers"].append(approver)
        committed = len(cr["approvers"]) >= cr["required"]
        if committed and cr["status"] == "pending":
            cr["status"] = "committed"
            roles = self._roles.setdefault(cr["target"], [])
            roles += [r for r in cr["add"] if r not in roles]
            self._roles[cr["target"]] = [r for r in roles if r not in cr["remove"]]
        sig = f"sig:{abs(hash((tide_cr_id, approver))) % 0xFFFF:04x}…{len(cr['approvers']):02x}"
        return ApprovalResult(len(cr["approvers"]), cr["required"], committed, sig, "14/20")

    def status(self, tide_cr_id):
        return self._crs[tide_cr_id]["status"]

    def revoke_role(self, target_user, roles):
        self._roles[target_user] = [r for r in self._roles.get(target_user, []) if r not in roles]

    def user_roles(self, username):
        return list(self._roles.get(username, []))


class RealTideGovernance:
    """TODO #15: implement against TideCloak change-request API (spike issue #1)."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def propose_role_change(self, target_user, add, remove, reason, meta):
        raise NotImplementedError("TODO #15: POST role-mappings -> TideCloak change request")

    def approve(self, tide_cr_id, approver):
        raise NotImplementedError("TODO #15: approve change request (API or admin console popup + poll)")

    def status(self, tide_cr_id):
        raise NotImplementedError("TODO #15")

    def revoke_role(self, target_user, roles):
        raise NotImplementedError("TODO #15: DELETE role-mappings (quorum needed?)")

    def user_roles(self, username):
        raise NotImplementedError("TODO #15")


def make_governance(settings: Settings) -> TideGovernance:
    if settings.governance_mode == "real":
        return RealTideGovernance(settings)
    from .auth import SEED_USERS
    return MockTideGovernance({u.username: u.roles for u in SEED_USERS.values()})
