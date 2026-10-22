"""Policy engine: tier by capability, escalation, duration cap. Policy body per docs/API.md §2.3."""
import json
import sqlite3
from dataclasses import dataclass, field

TIERS = ["T0", "T1", "T2", "T3"]
NEVER_FOR_AGENTS = {"roles.grant"}
CAPABILITY_ROLES = {"customer_pii.selfdecrypt": ["_tide_customer_pii.selfdecrypt"]}

DEFAULT_POLICY = {
    "version": "v7",
    "tiers": {
        "T0": {"label": "Auto", "required": 0, "of": 0, "max_duration_min": None, "eligible": [],
               "examples": ["services.restart", "deploy.rollback", "metrics.read", "logs.read"]},
        "T1": {"label": "1-of-2", "required": 1, "of": 2, "max_duration_min": None,
               "eligible": ["oncall", "security-lead"], "examples": ["deploy.hotfix", "scale.up"]},
        "T2": {"label": "2-of-3", "required": 2, "of": 3, "max_duration_min": 30,
               "eligible": ["oncall", "security-lead", "platform-admin"],
               "examples": ["customer_pii.selfdecrypt"]},
        "T3": {"label": "3-of-3", "required": 3, "of": 3, "max_duration_min": None,
               "eligible": ["oncall", "security-lead", "platform-admin"],
               "examples": ["roles.grant", "secrets.rotate", "policy.edit", "audit.write"]},
    },
    "capability_tier": {
        "services.restart": "T0", "deploy.rollback": "T0", "metrics.read": "T0", "logs.read": "T0",
        "deploy.hotfix": "T1", "scale.up": "T1", "customer_pii.selfdecrypt": "T2",
        "roles.grant": "T3", "secrets.rotate": "T3", "policy.edit": "T3", "audit.write": "T3",
    },
    "escalation": [
        {"rule": "injection_in_agent_context", "effect": "+1 tier (cap T3) + flag security_review"},
        {"rule": "outside_incident_window", "effect": "+1 tier (cap T3)"},
        {"rule": "agent_never_holds", "capabilities": ["roles.grant"]},
        {"rule": "requester_cannot_approve"},
    ],
}


@dataclass
class TierDecision:
    base_tier: str
    tier: str
    escalated: bool
    escalation_reason: str | None
    flags: list[str] = field(default_factory=list)


class UnknownCapability(ValueError):
    pass


class Policy:
    def __init__(self, body: dict):
        self.body = body

    @classmethod
    def load(cls, db: sqlite3.Connection) -> "Policy":
        row = db.execute(
            "SELECT body_json FROM policy_versions ORDER BY created_at DESC, version DESC LIMIT 1").fetchone()
        return cls(json.loads(row["body_json"]) if row and row["body_json"] else DEFAULT_POLICY)

    def tier_spec(self, tier: str) -> dict:
        return self.body["tiers"][tier]

    def decide(self, capability: str, context_flagged: bool = False) -> TierDecision:
        base = self.body["capability_tier"].get(capability)
        if base is None:
            raise UnknownCapability(capability)
        if not context_flagged:
            return TierDecision(base, base, False, None)
        tier = TIERS[min(len(TIERS) - 1, TIERS.index(base) + 1)]
        return TierDecision(base, tier, True, "injection detected in agent context",
                            ["injection", "security_review"])

    def max_duration(self, tier: str) -> int | None:
        return self.tier_spec(tier).get("max_duration_min")

    def agent_forbidden(self, capability: str) -> bool:
        for rule in self.body.get("escalation", []):
            if rule.get("rule") == "agent_never_holds":
                return capability in rule.get("capabilities", [])
        return capability in NEVER_FOR_AGENTS
