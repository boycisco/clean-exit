from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from fastapi import Depends, Header, Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session
from errors import ApiError
from models import Agent, Owner


TOKEN_PREFIX = "ce_"
_TOKEN_ENTROPY_BYTES = 32  # ~256 bits


def generate_token() -> str:
    """Create a new high-entropy API token with a recognizable prefix.

    The prefix 'ce_' helps secret scanners identify leaked tokens. The
    suffix is URL-safe base64, ~43 characters for 32 random bytes.
    """
    return TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_ENTROPY_BYTES)


def hash_token(raw: str) -> str:
    """Return the SHA-256 hex digest of a raw token.

    SHA-256 is appropriate here (not bcrypt/argon2) because tokens carry
    ~256 bits of entropy. Slow password hashes exist to defend against
    dictionary attacks on low-entropy passwords; they add cost without
    benefit for uniformly random 32-byte secrets.
    """
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def verify_token(raw: str, stored_hash: str) -> bool:
    """Constant-time comparison of a raw token against a stored hash."""
    return hmac.compare_digest(hash_token(raw), stored_hash)


async def require_owner(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Owner:
    """FastAPI dependency: resolve the calling owner from a Bearer token."""
    if not authorization:
        raise ApiError("unauthorized", "Missing Authorization header.", status_code=401)
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ApiError("unauthorized", "Expected 'Bearer <token>'.", status_code=401)
    raw = parts[1].strip()
    if not raw:
        raise ApiError("unauthorized", "Empty token.", status_code=401)

    token_hash = hash_token(raw)
    result = await session.execute(select(Owner).where(Owner.token_hash == token_hash))
    owner = result.scalar_one_or_none()
    if owner is None or owner.revoked_at is not None:
        # Same response for "not found" and "revoked" — no information leak.
        raise ApiError("unauthorized", "Invalid or revoked token.", status_code=401)

    # Touch last_used_at. A write per authenticated request is acceptable
    # for this scope; a Redis cache would be premature.
    owner.last_used_at = datetime.now(timezone.utc)
    await session.commit()
    return owner


async def require_agent_owner(
    agent_id: str = Path(...),
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> Agent:
    """FastAPI dependency: agent exists AND belongs to the calling owner."""
    result = await session.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent is None or agent.owner_id != owner.id:
        # Return 404, not 403, to avoid leaking which IDs exist.
        raise ApiError("not_found", "Agent not found.", status_code=404)
    return agent


async def bootstrap_owner(
    session: AsyncSession,
    token: str,
    *,
    name: str = "bootstrap",
) -> Owner | None:
    """Idempotent: create the first owner iff none exist yet.

    Called from app startup when BOOTSTRAP_TOKEN is set. Returns the
    created owner, or None if an owner already existed (or the token
    was empty).
    """
    if not token:
        return None
    existing = await session.execute(select(Owner).limit(1))
    if existing.scalar_one_or_none() is not None:
        return None
    owner = Owner(name=name, token_hash=hash_token(token))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)
    return owner