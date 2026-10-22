import hashlib
from dataclasses import dataclass
from typing import Literal, Protocol

from .clock import iso, now
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
    def apply(self, tide_cr_id: str, target_user: str, add: list[str], remove: list[str],
              expires_at: str | None = None) -> None: ...
    def status(self, tide_cr_id: str) -> CRStatus: ...
    def revoke_role(self, target_user: str, roles: list[str]) -> None: ...
    def user_roles(self, username: str) -> list[str]: ...


class MockTideGovernance:
    """In-memory stand-in; fake `sig:` values, ORK "14/20". See docs/API.md §7.

    Base roles live in memory; roles applied through quorum are kept with `expires_at`
    and written through to the `role_grants` table once a DB is bound.
    """

    def __init__(self, seed_roles: dict[str, list[str]]):
        self._base = {u: list(r) for u, r in seed_roles.items()}
        self._grants: dict[tuple[str, str], dict] = {}
        self._crs: dict[str, dict] = {}
        self._db = None

    def bind_db(self, db) -> None:
        self._db = db
        self._grants = {(r["username"], r["role"]): {"expires_at": r["expires_at"], "request_id": r["request_id"]}
                        for r in db.execute("SELECT * FROM role_grants")}

    def reset(self, seed_roles: dict[str, list[str]]) -> None:
        self._base = {u: list(r) for u, r in seed_roles.items()}
        self._grants.clear()
        self._crs.clear()
        self._persist()

    def _persist(self) -> None:
        if self._db is None:
            return
        self._db.execute("DELETE FROM role_grants")
        self._db.executemany(
            "INSERT INTO role_grants (username, role, request_id, granted_at, expires_at) VALUES (?,?,?,?,?)",
            [(u, r, g.get("request_id"), g.get("granted_at"), g.get("expires_at"))
             for (u, r), g in self._grants.items()])
        self._db.commit()

    def propose_role_change(self, target_user, add, remove, reason, meta):
        rid = meta.get("request_id")
        cr_id = f"mock-cr-{rid[3:]}" if rid else f"mock-cr-{len(self._crs) + 1:04d}"
        self._crs[cr_id] = {"target": target_user, "add": add, "remove": remove,
                            "required": meta.get("required", 2), "approvers": list(meta.get("approvers", [])),
                            "status": "pending"}
        return cr_id

    def approve(self, tide_cr_id, approver):
        cr = self._crs[tide_cr_id]
        if approver not in cr["approvers"]:
            cr["approvers"].append(approver)
        committed = len(cr["approvers"]) >= cr["required"]
        if committed and cr["status"] == "pending":
            cr["status"] = "approved"
        digest = hashlib.sha256(f"{tide_cr_id}:{approver}".encode()).hexdigest()
        return ApprovalResult(len(cr["approvers"]), cr["required"], committed,
                              f"sig:{digest[:4]}…{digest[-4:]}", "14/20")

    def apply(self, tide_cr_id, target_user, add, remove, expires_at=None):
        for role in add:
            self._grants[(target_user, role)] = {"expires_at": expires_at, "request_id": tide_cr_id,
                                             "granted_at": iso(now())}
        self.revoke_role(target_user, remove)
        if tide_cr_id in self._crs:
            self._crs[tide_cr_id]["status"] = "committed"
        self._persist()

    def status(self, tide_cr_id):
        return self._crs[tide_cr_id]["status"]

    def revoke_role(self, target_user, roles):
        self._base[target_user] = [r for r in self._base.get(target_user, []) if r not in roles]
        for role in roles:
            self._grants.pop((target_user, role), None)
        self._persist()

    def user_roles(self, username):
        granted = [r for (u, r) in self._grants if u == username]
        return list(dict.fromkeys(self._base.get(username, []) + granted))


class RealTideGovernance:
    """TODO #15: implement against TideCloak change-request API (spike issue #1)."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def propose_role_change(self, target_user, add, remove, reason, meta):
        raise NotImplementedError("TODO #15: POST role-mappings -> TideCloak change request")

    def approve(self, tide_cr_id, approver):
        raise NotImplementedError("TODO #15: approve change request (API or admin console popup + poll)")

    def apply(self, tide_cr_id, target_user, add, remove, expires_at=None):
        raise NotImplementedError("TODO #15: commit approved change request")

    def status(self, tide_cr_id):
        raise NotImplementedError("TODO #15")

    def revoke_role(self, target_user, roles):
        raise NotImplementedError("TODO #15: DELETE role-mappings (quorum needed?)")

    def user_roles(self, username):
        raise NotImplementedError("TODO #15")


def make_governance(settings: Settings) -> TideGovernance:
    if settings.governance_mode == "real":
        return RealTideGovernance(settings)
    return MockTideGovernance(seed_roles())


def seed_roles() -> dict[str, list[str]]:
    from .auth import SEED_USERS
    return {u.username: list(u.roles) for u in SEED_USERS.values()}
