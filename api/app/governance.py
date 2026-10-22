import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import quote

import httpx

from .clock import iso, now
from .config import Settings
from .errors import ApiError

log = logging.getLogger("cosign.governance")

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


class TideGovernanceError(ApiError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(502, "tide_error", message, details)


class RealTideGovernance(MockTideGovernance):
    """Hybrid: Cosign counts quorum and keeps its own view of authority (mock bookkeeping);
    on commit/revoke it also drives TideCloak IGA (spike #1: role-mappings -> PENDING change
    request -> approve). With GOVERNANCE_FALLBACK_MOCK=true, Tide failures fall back to mock only.

    Revoke approves the REVOKE_ROLES CR with a single admin token (threshold 1 in the demo realm).
    With a Tide quorum > 1 more admins must sign: CẦN KIỂM CHỨNG.
    """

    def __init__(self, settings: Settings, seed_roles: dict[str, list[str]] | None = None,
                 transport: httpx.BaseTransport | None = None):
        super().__init__(seed_roles if seed_roles is not None else seed_roles_default())
        self.settings = settings
        self._http = httpx.Client(timeout=10, transport=transport)
        self._token: tuple[str, float] | None = None
        self.last_change_request_ids: list[str] = []

    def _fail(self, what: str, exc: Exception) -> None:
        if self.settings.governance_fallback_mock:
            log.warning("Tide %s failed, falling back to mock: %s", what, exc)
            return
        if isinstance(exc, TideGovernanceError):
            raise exc
        raise TideGovernanceError(f"TideCloak {what} failed: {exc}") from exc

    def _admin_token(self) -> str:
        if self._token and self._token[1] > time.monotonic():
            return self._token[0]
        s = self.settings
        r = self._http.post(
            f"{s.tidecloak_url}/realms/{s.tide_admin_realm}/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": s.tide_admin_client_id,
                  "username": s.tide_admin_user, "password": s.tide_admin_password})
        if r.status_code != 200:
            raise TideGovernanceError(f"admin token request returned {r.status_code}")
        body = r.json()
        self._token = (body["access_token"], time.monotonic() + max(5, body.get("expires_in", 60) - 10))
        return self._token[0]

    def _call(self, method: str, path: str, ok: tuple[int, ...] = (200, 201, 204, 202), **kw) -> httpx.Response:
        s = self.settings
        r = self._http.request(method, f"{s.tidecloak_url}/admin/realms/{s.tidecloak_realm}/{path}",
                               headers={"Authorization": f"Bearer {self._admin_token()}"}, **kw)
        if r.status_code not in ok:
            raise TideGovernanceError(f"{method} {path} returned {r.status_code}: {r.text[:200]}")
        return r

    def _user_id(self, username: str) -> str:
        users = self._call("GET", "users", params={"username": username, "exact": "true"}).json()
        if not users:
            raise TideGovernanceError(f"user {username} not found in realm {self.settings.tidecloak_realm}")
        return users[0]["id"]

    def _role_reps(self, roles: list[str]) -> list[dict]:
        reps = []
        for name in roles:
            r = self._call("GET", f"roles/{quote(name, safe='')}", ok=(200, 404))
            if r.status_code == 404:
                raise TideGovernanceError(f"realm role {name} does not exist")
            reps.append(r.json())
        return reps

    def _user_realm_roles(self, uid: str) -> set[str]:
        return {r["name"] for r in self._call("GET", f"users/{uid}/role-mappings/realm").json()}

    def _approve_matching(self, action: str, uid: str, role_ids: set[str]) -> list[str]:
        crs = self._call("GET", "iga/change-requests", params={"status": "PENDING"}).json()
        if isinstance(crs, dict):
            crs = crs.get("changeRequests") or crs.get("items") or []
        done = []
        for cr in crs:
            if cr.get("actionType") != action or cr.get("entityId") != uid:
                continue
            if not role_ids & {row.get("ROLE_ID") for row in cr.get("rows", [])}:
                continue
            self._call("POST", f"iga/change-requests/{cr['id']}/approve", json={})
            done.append(cr["id"])
        return done

    def _change_roles(self, username: str, roles: list[str], grant: bool) -> list[str]:
        uid = self._user_id(username)
        reps = self._role_reps(roles)
        have = self._user_realm_roles(uid)
        todo = [r for r in reps if (r["name"] not in have) == grant]
        ids: list[str] = []
        if todo:
            self._call("POST" if grant else "DELETE", f"users/{uid}/role-mappings/realm", json=todo)
            ids = self._approve_matching("GRANT_ROLES" if grant else "REVOKE_ROLES", uid, {r["id"] for r in todo})
            if not ids:
                raise TideGovernanceError("no matching PENDING change request after role-mapping call")
        after = self._user_realm_roles(uid)
        bad = [r for r in roles if (r in after) != grant]
        if bad:
            raise TideGovernanceError(f"roles {bad} not {'granted' if grant else 'removed'} after approve")
        return ids

    def apply(self, tide_cr_id, target_user, add, remove, expires_at=None):
        self.last_change_request_ids = []
        try:
            ids = []
            if add:
                ids += self._change_roles(target_user, add, True)
            if remove:
                ids += self._change_roles(target_user, remove, False)
        except (httpx.HTTPError, TideGovernanceError, KeyError, ValueError) as exc:
            self._fail("apply", exc)
        else:
            self.last_change_request_ids = ids
        super().apply(tide_cr_id, target_user, add, remove, expires_at)

    def revoke_role(self, target_user, roles):
        super().revoke_role(target_user, roles)
        if not roles:
            return
        try:
            self._change_roles(target_user, roles, False)
        except (httpx.HTTPError, TideGovernanceError, KeyError, ValueError) as exc:
            self._fail("revoke", exc)


def make_governance(settings: Settings) -> TideGovernance:
    if settings.governance_mode == "real":
        return RealTideGovernance(settings)
    return MockTideGovernance(seed_roles())


def seed_roles_default() -> dict[str, list[str]]:
    return seed_roles()


def seed_roles() -> dict[str, list[str]]:
    from .auth import SEED_USERS
    return {u.username: list(u.roles) for u in SEED_USERS.values()}
