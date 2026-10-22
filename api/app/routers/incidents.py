from fastapi import APIRouter, Depends

from .. import payments
from ..auth import require_roles
from ..mocks import Mock, mount_mocks

router = APIRouter()
anyone = [Depends(require_roles("*"))]


@router.get("/incidents", dependencies=anyone)
def incidents(db=Depends(payments.get_db)):
    return payments.list_incidents(db)


@router.get("/incidents/{id}", dependencies=anyone)
def incident(id: str, db=Depends(payments.get_db)):
    return payments.get_incident(db, id)


@router.get("/incidents/{id}/timeline", dependencies=anyone)
def incident_timeline(id: str, db=Depends(payments.get_db)):
    return payments.timeline(db, id)


@router.get("/incidents/{id}/metrics", dependencies=anyone)
def incident_metrics(id: str, db=Depends(payments.get_db)):
    return payments.metrics(db, id)


@router.get("/services", dependencies=anyone)
def services(db=Depends(payments.get_db)):
    return payments.list_services(db)


@router.get("/deploys", dependencies=anyone)
def deploys(service: str = payments.SERVICE, db=Depends(payments.get_db)):
    return payments.list_deploys(db, service)


@router.get("/logs", dependencies=anyone)
def logs(service: str = payments.SERVICE, since: str = "03:00", db=Depends(payments.get_db)):
    return payments.list_logs(db, service, since)


mount_mocks(router, [
    Mock("GET", "/incidents/{id}/access", "incident-access.json"),
    Mock("GET", "/incidents/{id}/receipt", "receipt.json", roles=("compliance", "security", "oncall")),
])
