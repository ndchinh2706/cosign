from fastapi import APIRouter

from ..mocks import Mock, mount_mocks

router = APIRouter()

mount_mocks(router, [
    Mock("GET", "/admin/users", "admin-users.json", roles=("admin", "security")),
    Mock("PUT", "/admin/users/{username}/roles", "admin-roles-put.json", 202, roles=("admin", "security")),
    Mock("GET", "/admin/data/merchants", "admin-merchants.json", roles=("admin", "security", "compliance")),
    Mock("POST", "/admin/data/merchants/export", "admin-export.json", roles=("admin",)),
    Mock("GET", "/admin/audit", "audit.json", roles=("admin",)),
    Mock("DELETE", "/admin/audit/{id}", "admin-audit-delete.json", 403, roles=("admin",)),
])
