import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    settings = Settings(_env_file=None, auth_mode="dev", seed_sample_records=False, db_path=str(tmp_path / "test.db"),
                        ws_auth_timeout_s=0.5, signing_tick_s=0, expiry_sweep_s=3600)
    with TestClient(create_app(settings)) as c:
        yield c
