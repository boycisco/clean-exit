from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    bootstrap_owner,
    generate_token,
    hash_token,
    require_agent_owner,
    require_owner,
    verify_token,
)
from errors import ApiError
from models import Agent, Owner


def test_generate_token_unique():
    tokens = {generate_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(t.startswith("ce_") for t in tokens)


def test_hash_token_deterministic():
    raw = "ce_abc"
    assert hash_token(raw) == hash_token(raw)
    assert hash_token(raw) != hash_token("ce_abd")


def test_verify_token_match_and_mismatch():
    raw = generate_token()
    stored = hash_token(raw)
    assert verify_token(raw, stored)
    assert not verify_token("ce_wrong", stored)


async def test_require_owner_no_header(session: AsyncSession):
    with pytest.raises(ApiError) as exc:
        await require_owner(authorization=None, session=session)
    assert exc.value.status_code == 401
    assert exc.value.code == "unauthorized"


async def test_require_owner_malformed(session: AsyncSession):
    for header in ["Bearer", "Basic abc", "Bearer   "]:
        with pytest.raises(ApiError) as exc:
            await require_owner(authorization=header, session=session)
        assert exc.value.status_code == 401


async def test_require_owner_unknown_token(session: AsyncSession):
    with pytest.raises(ApiError):
        await require_owner(authorization="Bearer ce_nope", session=session)


async def test_require_owner_revoked(session: AsyncSession):
    from datetime import datetime, timezone

    raw = generate_token()
    owner = Owner(name="revoked", token_hash=hash_token(raw))
    owner.revoked_at = datetime.now(timezone.utc)
    session.add(owner)
    await session.commit()

    with pytest.raises(ApiError):
        await require_owner(authorization=f"Bearer {raw}", session=session)


async def test_require_owner_success(session: AsyncSession):
    raw = generate_token()
    owner = Owner(name="ok", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    resolved = await require_owner(authorization=f"Bearer {raw}", session=session)
    assert resolved.id == owner.id
    assert resolved.last_used_at is not None


async def test_require_agent_owner_own(session: AsyncSession):
    raw = generate_token()
    owner = Owner(name="o", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    agent = Agent(owner_id=owner.id, name="mine", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    found = await require_agent_owner(
        agent_id=agent.id, owner=owner, session=session
    )
    assert found.id == agent.id


async def test_require_agent_owner_cross_owner(session: AsyncSession):
    owner_a = Owner(name="a", token_hash=hash_token("ce_a"))
    owner_b = Owner(name="b", token_hash=hash_token("ce_b"))
    session.add_all([owner_a, owner_b])
    await session.commit()

    agent = Agent(owner_id=owner_a.id, name="private", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    with pytest.raises(ApiError) as exc:
        await require_agent_owner(agent_id=agent.id, owner=owner_b, session=session)
    assert exc.value.status_code == 404
    assert exc.value.code == "not_found"


async def test_require_agent_owner_nonexistent(session: AsyncSession):
    raw = generate_token()
    owner = Owner(name="o", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    with pytest.raises(ApiError):
        await require_agent_owner(agent_id="does-not-exist", owner=owner, session=session)


async def test_bootstrap_creates_once(session: AsyncSession):
    first = await bootstrap_owner(session, "ce_bootstrap_secret")
    assert first is not None
    assert first.name == "bootstrap"

    second = await bootstrap_owner(session, "ce_other_secret")
    assert second is None  # already bootstrapped


async def test_bootstrap_skips_empty(session: AsyncSession):
    assert await bootstrap_owner(session, "") is None