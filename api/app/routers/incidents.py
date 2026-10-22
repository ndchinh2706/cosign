from fastapi import APIRouter

from ..mocks import Mock, mount_mocks

router = APIRouter()

mount_mocks(router, [
    Mock("GET", "/incidents", "incidents.json"),
    Mock("GET", "/incidents/{id}", "incident.json"),
    Mock("GET", "/incidents/{id}/timeline", "incident-timeline.json"),
    Mock("GET", "/incidents/{id}/metrics", "incident-metrics.json"),
    Mock("GET", "/incidents/{id}/access", "incident-access.json"),
    Mock("GET", "/incidents/{id}/receipt", "receipt.json", roles=("compliance", "security", "oncall")),
    Mock("GET", "/services", "services.json"),
    Mock("GET", "/deploys", "deploys.json"),
    Mock("GET", "/logs", "logs.json"),
])
