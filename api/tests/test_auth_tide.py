import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from fastapi.testclient import TestClient

from app import auth
from app.config import Settings
from app.main import create_app

ISS = "http://tidecloak:8080/realms/cosign"


def _jwk(key, kid, alg):
    pub = key.public_key()
    jwk = (jwt.algorithms.OKPAlgorithm.to_jwk(pub, as_dict=True) if alg == "EdDSA"
           else jwt.algorithms.RSAAlgorithm.to_jwk(pub, as_dict=True))
    return {**jwk, "kid": kid, "alg": alg, "use": "sig"}


@pytest.fixture
def keys():
    return {
        "ed": (ed25519.Ed25519PrivateKey.generate(), "EdDSA", "k-ed"),
        "rsa": (rsa.generate_private_key(public_exponent=65537, key_size=2048), "RS256", "k-rsa"),
    }


@pytest.fixture
def tide(tmp_path, monkeypatch, keys):
    state = {"n": 0, "keys": [_jwk(k, kid, alg) for k, alg, kid in keys.values()]}

    def fake_fetch(url):
        state["n"] += 1
        return state["keys"]

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch)
    auth._JWKS_CACHE.clear()
    settings = Settings(_env_file=None, auth_mode="tide", db_path=str(tmp_path / "t.db"),
                        ws_auth_timeout_s=0.5, signing_tick_s=0, expiry_sweep_s=3600)
    with TestClient(create_app(settings)) as c:
        c.state = state
        yield c
    auth._JWKS_CACHE.clear()


def make(keys, which="ed", **over):
    key, alg, kid = keys[which]
    claims = {"iss": ISS, "exp": int(time.time()) + 300, "azp": "cosign-web",
              "preferred_username": "marcus.lee", "email": "m@x",
              "realm_access": {"roles": ["security-lead"]}}
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


def me(c, token):
    return c.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})


@pytest.mark.parametrize("which", ["ed", "rsa"])
def test_valid_token(tide, keys, which):
    r = me(tide, make(keys, which))
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "marcus.lee"
    assert "security-lead" in r.json()["roles"]


def test_no_token_401(tide):
    assert tide.get("/api/v1/me").status_code == 401


def test_bad_signature(tide):
    other = ed25519.Ed25519PrivateKey.generate()
    tok = jwt.encode({"iss": ISS, "exp": int(time.time()) + 300, "azp": "cosign-web",
                      "preferred_username": "marcus.lee"}, other, algorithm="EdDSA", headers={"kid": "k-ed"})
    assert me(tide, tok).status_code == 401


def test_expired(tide, keys):
    assert me(tide, make(keys, exp=int(time.time()) - 10)).status_code == 401


def test_wrong_issuer(tide, keys):
    assert me(tide, make(keys, iss="http://evil/realms/cosign")).status_code == 401


def test_wrong_client(tide, keys):
    assert me(tide, make(keys, azp="other", aud="account")).status_code == 401


def test_aud_accepts_client(tide, keys):
    assert me(tide, make(keys, azp=None, aud=["account", "cosign-web"])).status_code == 200


def test_alg_none_rejected(tide):
    tok = jwt.encode({"iss": ISS, "exp": int(time.time()) + 300, "preferred_username": "x"},
                     None, algorithm="none")
    assert me(tide, tok).status_code == 401


def test_resource_access_roles(tide, keys):
    tok = make(keys, realm_access=None,
               resource_access={"cosign-web": {"roles": ["compliance", "_tide_customer_pii.selfdecrypt"]}})
    r = me(tide, tok)
    assert r.status_code == 200
    assert "compliance" in r.json()["roles"]
    assert "_tide_customer_pii.selfdecrypt" in r.json()["roles"]


def test_unknown_kid_refetches(tide, keys):
    assert me(tide, make(keys, "ed")).status_code == 200
    n = tide.state["n"]
    new = ed25519.Ed25519PrivateKey.generate()
    tide.state["keys"].append(_jwk(new, "k-new", "EdDSA"))
    url = next(iter(auth._JWKS_CACHE))
    auth._JWKS_CACHE[url] = (time.monotonic() - 60, auth._JWKS_CACHE[url][1])
    tok = jwt.encode({"iss": ISS, "exp": int(time.time()) + 300, "azp": "cosign-web",
                      "preferred_username": "dave.kim"}, new, algorithm="EdDSA", headers={"kid": "k-new"})
    assert me(tide, tok).status_code == 200
    assert tide.state["n"] == n + 1


def test_ws_auth_with_token(tide, keys):
    with tide.websocket_connect("/ws") as ws:
        ws.send_json({"v": 1, "type": "auth", "payload": {"token": make(keys)}})
        ok = ws.receive_json()
        assert ok["type"] == "auth_ok"
        assert ok["payload"]["user"] == "marcus.lee"


def test_ws_bad_token(tide, keys):
    with tide.websocket_connect("/ws") as ws:
        ws.send_json({"v": 1, "type": "auth", "payload": {"token": make(keys, exp=1)}})
        assert ws.receive_json()["payload"]["code"] == "unauthenticated"


def test_tide_mode_ignores_demo_header(tide):
    assert tide.get("/api/v1/me", headers={"X-Demo-User": "linh.tran"}).status_code == 401
