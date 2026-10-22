from fastapi import APIRouter

from ..mocks import Mock, mount_mocks

router = APIRouter()

AUDIT_READERS = ("compliance", "security", "admin", "oncall")

mount_mocks(router, [
    Mock("GET", "/audit", "audit.json", roles=AUDIT_READERS),
    Mock("GET", "/audit/{id}", "audit-event.json", roles=AUDIT_READERS),
    Mock("POST", "/audit/{id}/verify", "audit-verify.json", roles=AUDIT_READERS),
])
