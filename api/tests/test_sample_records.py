from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

P = "/api/v1"
AGENT = {"X-Demo-User": "ai-oncall-agent"}
LINH = {"X-Demo-User": "linh.tran"}


def test_sample_records_seeded_when_empty(tmp_path):
    s = Settings(_env_file=None, auth_mode="dev", db_path=str(tmp_path / "s.db"), signing_tick_s=0, expiry_sweep_s=3600)
    with TestClient(create_app(s)) as c:
        ids = [r["id"] for r in c.get(f"{P}/records", headers=AGENT).json()["items"]]
        assert ids == ["mrc_8812", "mrc_8830", "mrc_8841", "mrc_8857", "mrc_8863"]
        c.post(f"{P}/demo/reset", headers=LINH, json={"wipe_records": True})
        assert c.get(f"{P}/records", headers=AGENT).json()["items"] == []
        c.post(f"{P}/demo/reset", headers=LINH)
        assert len(c.get(f"{P}/records", headers=AGENT).json()["items"]) == 5
