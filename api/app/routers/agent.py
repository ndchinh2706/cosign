from fastapi import APIRouter

from ..mocks import Mock, mount_mocks

router = APIRouter()

# TODO: real agent loop (Anthropic SDK + 6 tools, AGENT_MODE=scripted fallback) per docs/API.md §4.2–4.6.
mount_mocks(router, [
    Mock("POST", "/agent/runs", "agent-run-create.json", 201, roles=("agent", "oncall", "security")),
    Mock("GET", "/agent/runs", "agent-runs.json"),
    Mock("GET", "/agent/runs/{id}", "agent-run.json"),
    Mock("GET", "/agent/runs/{id}/summary", "agent-run-summary.json"),
    Mock("POST", "/agent/runs/{id}/pause", roles=("oncall", "security"),
         body={"run_id": "run_01", "status": "paused"}),
    Mock("POST", "/agent/runs/{id}/resume", roles=("oncall", "security"),
         body={"run_id": "run_01", "status": "running"}),
    Mock("POST", "/agent/runs/{id}/quarantine", roles=("security",),
         body={"run_id": "run_01", "context_quarantined": True}),
    Mock("POST", "/agent/runs/{id}/tool-result", roles=("agent",), body={"accepted": True}),
])
