import json

import httpx
import pytest

from app.config import Settings
from app.errors import ApiError
from app.governance import RealTideGovernance

ROLE = "_tide_customer_pii.selfdecrypt"
UID, RID = "u-1", "r-1"


class FakeTide:
    def __init__(self, fail_token=False):
        self.assigned, self.crs, self.fail_token = set(), {}, fail_token

    def _cr(self, action, uid, rid):
        id_ = f"cr-{len(self.crs) + 1}"
        self.crs[id_] = {"id": id_, "actionType": action, "entityId": uid, "status": "PENDING",
                         "rows": [{"ROLE_ID": rid, "USER_ID": uid}]}

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path, m = req.url.path, req.method
        if path.endswith("/openid-connect/token"):
            if self.fail_token:
                return httpx.Response(401)
            return httpx.Response(200, json={"access_token": "t", "expires_in": 60})
        p = path.split("/admin/realms/cosign/")[1]
        if p == "users":
            return httpx.Response(200, json=[{"id": UID}])
        if p.startswith("roles/"):
            return httpx.Response(200, json={"id": RID, "name": ROLE})
        if p == f"users/{UID}/role-mappings/realm":
            if m == "GET":
                return httpx.Response(200, json=[{"id": RID, "name": ROLE}] if ROLE in self.assigned else [])
            assert json.loads(req.content)[0]["name"] == ROLE
            self._cr("GRANT_ROLES", "other-user", "other-role")
            self._cr("GRANT_ROLES" if m == "POST" else "REVOKE_ROLES", UID, RID)
            return httpx.Response(204)
        if p == "iga/change-requests":
            return httpx.Response(200, json=[c for c in self.crs.values() if c["status"] == "PENDING"])
        if p.startswith("iga/change-requests/") and p.endswith("/approve"):
            cr = self.crs[p.split("/")[2]]
            cr["status"] = "APPROVED"
            if cr["entityId"] == UID:
                (self.assigned.add if cr["actionType"] == "GRANT_ROLES" else self.assigned.discard)(ROLE)
            return httpx.Response(200, json={"committed": True})
        return httpx.Response(404)


def make(tide, **kw):
    s = Settings(_env_file=None, tidecloak_url="http://tide", tidecloak_realm="cosign", tide_admin_password="x", **kw)
    return RealTideGovernance(s, {"linh.tran": ["oncall"]}, transport=httpx.MockTransport(tide))


def test_apply_creates_mapping_and_approves_only_matching_cr():
    tide = FakeTide()
    g = make(tide)
    g.apply("cr-x", "linh.tran", [ROLE], [], None)
    assert ROLE in tide.assigned
    assert g.last_change_request_ids == ["cr-2"]
    assert tide.crs["cr-1"]["status"] == "PENDING"
    assert ROLE in g.user_roles("linh.tran")


def test_revoke_removes_role_and_approves_revoke_cr():
    tide = FakeTide()
    g = make(tide)
    g.apply("cr-x", "linh.tran", [ROLE], [], None)
    g.revoke_role("linh.tran", [ROLE])
    assert ROLE not in tide.assigned
    assert any(c["actionType"] == "REVOKE_ROLES" and c["status"] == "APPROVED" for c in tide.crs.values())
    assert ROLE not in g.user_roles("linh.tran")


def test_tide_error_raises_without_granting():
    g = make(FakeTide(fail_token=True))
    with pytest.raises(ApiError) as e:
        g.apply("cr-x", "linh.tran", [ROLE], [], None)
    assert e.value.status == 502
    assert ROLE not in g.user_roles("linh.tran")


def test_fallback_mock_when_flag_set():
    g = make(FakeTide(fail_token=True), governance_fallback_mock=True)
    g.apply("cr-x", "linh.tran", [ROLE], [], None)
    assert ROLE in g.user_roles("linh.tran")
    g.revoke_role("linh.tran", [ROLE])
    assert ROLE not in g.user_roles("linh.tran")


def test_failed_apply_keeps_request_approved(client):
    old = client.app.state.governance
    gov = make(FakeTide(fail_token=True))
    gov._crs = old._crs
    client.app.state.governance = gov
    client.post("/api/v1/requests/CR-0192/approve", headers={"X-Demo-User": "linh.tran"})
    r = client.post("/api/v1/requests/CR-0192/approve", headers={"X-Demo-User": "marcus.lee"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "approved" and body["apply_status"] == "failed"
    assert ROLE not in gov.user_roles("ai-oncall-agent")
