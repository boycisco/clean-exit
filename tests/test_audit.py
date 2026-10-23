from __future__ import annotations

import httpx
import pytest

import audit
from auth import hash_token
from models import Agent, Owner


@pytest.fixture
async def client(session, monkeypatch):
    async def fake_near(rpc_url: str) -> str:
        return "ok"

    monkeypatch.setattr("app._check_near", fake_near)

    from app import create_app
    from database import get_session

    application = create_app()

    async def _override():
        yield session

    application.dependency_overrides[get_session] = _override

    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def setup(session, client):
    raw = "ce_owner_token"
    owner = Owner(name="o", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    agent = Agent(owner_id=owner.id, name="a", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    # Seed three events out of chronological order to prove sorting works.
    for action, payload in [
        ("event_one", {"n": 1}),
        ("event_two", {"n": 2}),
        ("event_three", {"n": 3}),
    ]:
        await audit.record(
            session,
            agent_id=agent.id,
            actor_owner_id=owner.id,
            action=action,
            payload=payload,
        )
    await session.commit()

    return owner, raw, agent


def _h(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


async def test_audit_returns_events_in_order(client, setup):
    _o, raw, agent = setup
    r = await client.get(f"/api/v1/agents/{agent.id}/audit", headers=_h(raw))
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 3
    actions = [e["action"] for e in events]
    assert actions == ["event_one", "event_two", "event_three"]
    # Chronological (oldest first).
    times = [e["created_at"] for e in events]
    assert times == sorted(times)


async def test_audit_pagination(client, setup):
    _o, raw, agent = setup
    r = await client.get(
        f"/api/v1/agents/{agent.id}/audit",
        headers=_h(raw),
        params={"limit": 2, "offset": 0},
    )
    assert r.status_code == 200
    assert len(r.json()) == 2

    r = await client.get(
        f"/api/v1/agents/{agent.id}/audit",
        headers=_h(raw),
        params={"limit": 2, "offset": 2},
    )
    assert len(r.json()) == 1


async def test_audit_cross_owner_404(client, setup, session):
    _o, _raw, agent = setup
    other = Owner(name="other", token_hash=hash_token("ce_other"))
    session.add(other)
    await session.commit()

    r = await client.get(
        f"/api/v1/agents/{agent.id}/audit",
        headers={"Authorization": "Bearer ce_other"},
    )
    assert r.status_code == 404


async def test_audit_requires_auth(client, setup):
    _o, _raw, agent = setup
    r = await client.get(f"/api/v1/agents/{agent.id}/audit")
    assert r.status_code == 401