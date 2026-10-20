from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import Agent, Authority, Owner, TerminationJob


async def test_create_agent_with_authority(session: AsyncSession):
    owner = Owner(name="alice", token_hash="hash-a")
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    agent = Agent(owner_id=owner.id, name="tmp", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    assert agent.status == "active"

    auth = Authority(
        agent_id=agent.id,
        type="near_function_key",
        provider="near",
        resource="ed25519:ABC",
        state="active",
    )
    session.add(auth)
    await session.commit()
    await session.refresh(auth)
    assert auth.id
    assert auth.agent_id == agent.id


async def test_authority_graph_roundtrip(session: AsyncSession):
    owner = Owner(name="bob", token_hash="hash-b")
    session.add(owner)
    await session.commit()

    agent = Agent(owner_id=owner.id, name="delegator", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    parent = Authority(
        agent_id=agent.id, type="near_function_key", provider="near",
        resource="ed25519:PARENT", state="active",
    )
    session.add(parent)
    await session.commit()
    await session.refresh(parent)

    child = Authority(
        agent_id=agent.id, parent_id=parent.id, type="child_delegation",
        provider="clean", resource="child-agent-1", state="active",
    )
    session.add(child)
    await session.commit()
    await session.refresh(child)
    assert child.parent_id == parent.id


async def test_idempotency_key_unique_per_agent(session: AsyncSession):
    owner = Owner(name="carol", token_hash="hash-c")
    session.add(owner)
    await session.commit()

    agent = Agent(owner_id=owner.id, name="x", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    j1 = TerminationJob(agent_id=agent.id, owner_id=owner.id, idempotency_key="key-1")
    session.add(j1)
    await session.commit()

    j2 = TerminationJob(agent_id=agent.id, owner_id=owner.id, idempotency_key="key-1")
    session.add(j2)
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()