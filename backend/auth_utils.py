import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import PyJWTError
from passlib.context import CryptContext

from db import DB_NAME, MONGO_URL, users_col

logger = logging.getLogger(__name__)


def _resolve_jwt_secret() -> str:
    """JWT signing secret that survives a lost/partial .env.

    1. JWT_SECRET env var (normal case).
    2. Otherwise a random secret generated ONCE and persisted in MongoDB
       (`app_config` doc `_id="jwt_secret"`), so every restart/replica signs
       with the same key and users stay logged in. `$setOnInsert` makes
       concurrent first boots converge on a single value.
    3. Last resort (database unreachable at import): an in-memory random
       secret — the API still boots; sessions just reset on the next restart.
    """
    env_secret = (os.environ.get("JWT_SECRET") or "").strip()
    if env_secret:
        return env_secret
    try:
        from pymongo import MongoClient, ReturnDocument

        sync_client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=8000)
        try:
            doc = sync_client[DB_NAME]["app_config"].find_one_and_update(
                {"_id": "jwt_secret"},
                {"$setOnInsert": {"value": secrets.token_hex(32)}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        finally:
            sync_client.close()
        value = (doc or {}).get("value")
        if value:
            logger.warning("JWT_SECRET not set — using the secret persisted in MongoDB")
            return value
    except Exception as exc:  # pragma: no cover - only when Mongo is down at boot
        logger.error("JWT_SECRET not set and MongoDB unreachable (%s); using a temporary secret", exc)
    return secrets.token_hex(32)


JWT_SECRET = _resolve_jwt_secret()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
# Admin sessions are deliberately short-lived (rotation) — the dashboard asks
# for a fresh sign-in once the window lapses.
ADMIN_SESSION_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, *, admin: bool = False, admin_ver: int = 0) -> str:
    now = datetime.now(timezone.utc)
    if admin:
        payload = {
            "sub": user_id,
            "iat": now,
            "exp": now + timedelta(minutes=ADMIN_SESSION_MINUTES),
            "kind": "admin",
            "ver": admin_ver,
        }
    else:
        payload = {
            "sub": user_id,
            "iat": now,
            "exp": now + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS),
        }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_payload(token: str) -> dict:
    """Full verified JWT payload (raises PyJWTError on invalid/expired)."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def decode_token(token: str) -> str:
    """Returns user_id or raises PyJWTError."""
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    sub = payload.get("sub")
    if not sub:
        raise PyJWTError("Missing subject")
    return sub


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        user_id = decode_token(token)
    except PyJWTError:
        raise credentials_exception
    user = await users_col.find_one({"_id": user_id})
    if user is None:
        raise credentials_exception
    if user.get("banned"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been banned.",
        )
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]
