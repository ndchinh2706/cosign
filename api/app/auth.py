from dataclasses import dataclass, field
from functools import lru_cache

import jwt
from fastapi import Depends, Request

from .config import Settings, get_settings
from .errors import ApiError

ROLE_ALIASES = {"security": "security-lead", "admin": "platform-admin"}


@dataclass
class User:
    username: str
    display_name: str
    type: str
    roles: list[str] = field(default_factory=list)
    email: str = ""
    avatar: str = "round"
    home: str = "/"

    def has_any(self, roles: tuple[str, ...]) -> bool:
        return any(ROLE_ALIASES.get(r, r) in self.roles for r in roles)

    def public(self) -> dict:
        return {"username": self.username, "display_name": self.display_name, "type": self.type,
                "email": self.email, "avatar": self.avatar}


# Seed per docs/API.md §1.1 (dev mode identity source).
SEED_USERS: dict[str, User] = {u.username: u for u in [
    User("ai-oncall-agent", "Atlas", "agent", ["agent", "_tide_customer_pii.selfencrypt"],
         "ai-oncall-agent@northwind", "hexagon", "/agent"),
    User("linh.tran", "Linh Tran", "human", ["oncall", "tide-realm-admin"],
         "linh.tran@northwind", "round", "/incidents"),
    User("marcus.lee", "Marcus Lee", "human",
         ["security-lead", "tide-realm-admin", "_tide_customer_pii.selfencrypt", "_tide_customer_pii.selfdecrypt"],
         "marcus.lee@northwind", "round", "/governance"),
    User("dave.kim", "Dave Kim", "human", ["platform-admin", "tide-realm-admin"],
         "dave.kim@northwind", "round", "/admin/users"),
    User("priya.nair", "Priya Nair", "human", ["compliance"],
         "priya.nair@northwind", "round", "/audit"),
]}

HOME_BY_ROLE = [("agent", "/agent"), ("security-lead", "/governance"), ("oncall", "/incidents"),
                ("platform-admin", "/admin/users"), ("compliance", "/audit")]


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=600)


def verify_token(token: str, settings: Settings) -> User:
    # TODO #14: confirm alg + where Tide puts _tide_* roles (realm_access vs resource_access) against a live TideCloak.
    try:
        key = _jwks_client(settings.effective_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=["EdDSA", "RS256", "ES256"],
                            options={"verify_aud": False})
    except jwt.PyJWTError as e:
        raise ApiError(401, "unauthenticated", f"invalid token: {e}") from e
    username = claims.get("preferred_username", "")
    roles = list(claims.get("realm_access", {}).get("roles", []))
    for client in claims.get("resource_access", {}).values():
        roles += client.get("roles", [])
    seed = SEED_USERS.get(username)
    home = next((h for r, h in HOME_BY_ROLE if r in roles), "/")
    return User(username, seed.display_name if seed else username,
                seed.type if seed else "human", roles, claims.get("email", ""),
                seed.avatar if seed else "round", home)


def user_from_credential(*, token: str | None, demo_user: str | None, settings: Settings) -> User:
    if settings.auth_mode == "dev":
        if demo_user in SEED_USERS:
            return SEED_USERS[demo_user]
        raise ApiError(401, "unauthenticated", "X-Demo-User header with a seed username required")
    if not token:
        raise ApiError(401, "unauthenticated", "bearer token required")
    return verify_token(token, settings)


def current_user(request: Request, settings: Settings = Depends(get_settings)) -> User:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else None
    return user_from_credential(token=token, demo_user=request.headers.get("x-demo-user"), settings=settings)


def require_roles(*roles: str):
    """Dependency factory. `*` or no roles = any signed-in user. Aliases: security, admin."""
    def dep(user: User = Depends(current_user)) -> User:
        if roles and "*" not in roles and not user.has_any(roles):
            raise ApiError(403, "forbidden", f"one of roles {list(roles)} required")
        return user
    return dep
