from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(REPO_ROOT / ".env", ".env"), extra="ignore")

    auth_mode: Literal["dev", "tide"] = "tide"
    governance_mode: Literal["mock", "real"] = "mock"
    agent_mode: Literal["scripted", "llm"] = "llm"
    scan_mode: Literal["heuristic", "model"] = "heuristic"

    tidecloak_url: str = "http://tidecloak:8080"
    tidecloak_realm: str = "cosign"
    jwks_url: str = ""
    jwt_issuer: str = ""
    tide_admin_user: str = "admin"
    tide_admin_password: str = ""
    tide_admin_realm: str = "master"
    tide_admin_client_id: str = "admin-cli"
    governance_fallback_mock: bool = False
    tidecloak_client_id: str = "cosign-web"
    jwt_verify_aud: bool = True

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"

    db_path: str = "cosign.db"
    seed_sample_records: bool = True
    mocks_dir: Path = REPO_ROOT / "docs" / "mocks"
    cors_origins: list[str] = ["http://localhost:3000"]
    ws_auth_timeout_s: float = 5.0
    signing_tick_s: float = 0.2
    expiry_sweep_s: float = 5.0
    agent_step_delay_s: float = 1.2
    agent_tool_timeout_s: float = 30.0
    agent_approval_timeout_s: float = 900.0
    agent_max_turns: int = 24
    version: str = "0.1.0"

    @property
    def effective_jwks_url(self) -> str:
        return self.jwks_url or (
            f"{self.tidecloak_url}/realms/{self.tidecloak_realm}/protocol/openid-connect/certs"
        )

    @property
    def effective_issuer(self) -> str:
        return self.jwt_issuer or f"{self.tidecloak_url}/realms/{self.tidecloak_realm}"

    @property
    def effective_agent_mode(self) -> str:
        return self.agent_mode if self.anthropic_api_key else "scripted"


@lru_cache
def get_settings() -> Settings:
    return Settings()
