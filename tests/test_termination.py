from __future__ import annotations

import httpx
import pytest

from auth import hash_token
from models import Agent, Authority, Owner, TerminationJob


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
async def owner(session):
    raw = "ce_owner_token"
    o = Owner(name="owner", token_hash=hash_token(raw))
    session.add(o)
    await session.commit()
    await session.refresh(o)
    return o, raw


@pytest.fixture
async def agent_with_graph(session, owner):
    _o, raw = owner
    agent = Agent(owner_id=_o.id, name="a", near_account="alice.testnet", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    parent = Authority(
        agent_id=agent.id, type="near_function_key", provider="near",
        resource="ed25519:PARENT", state="unverified",
    )
    child = Authority(
        agent_id=agent.id, parent_id=parent.id, type="child_delegation",
        provider="clean", resource="child", state="active",
    )
    obligation = Authority(
        agent_id=agent.id, type="obligation", provider="near",
        resource="pending", state="active",
    )
    session.add_all([parent, child, obligation])
    await session.commit()
    for r in (parent, child, obligation):
        await session.refresh(r)
    return agent, raw, parent, child, obligation


def _h(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


async def test_plan_post_order(client, agent_with_graph):
    agent, raw, parent, child, obligation = agent_with_graph
    r = await client.get(
        f"/api/v1/agents/{agent.id}/termination-plan", headers=_h(raw)
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # Child before parent; obligation independent.
    orders = {s["authority_id"]: s["order"] for s in data["steps"]}
    assert orders[child.id] < orders[parent.id]
    assert data["total_authorities"] == 3


async def test_plan_counts_supported_unsupported(client, agent_with_graph):
    agent, raw, parent, child, obligation = agent_with_graph
    r = await client.get(
        f"/api/v1/agents/{agent.id}/termination-plan", headers=_h(raw)
    )
    data = r.json()
    # Without signer, near_function_key is unsupported; child delegation supported;
    # obligation partial (counted as manual).
    assert data["unsupported_count"] >= 1
    assert data["supported_count"] >= 1
    assert data["manual_count"] >= 1


async def test_terminate_creates_job(client, agent_with_graph):
    agent, raw, *_ = agent_with_graph
    r = await client.post(
        f"/api/v1/agents/{agent.id}/terminate",
        headers=_h(raw),
        json={"reason": "done", "idempotency_key": "k1"},
    )
    assert r.status_code == 202, r.text
    data = r.json()
    assert data["status"] == "pending"
    assert data["phase"] == "validate"


async def test_terminate_idempotent(client, agent_with_graph):
    agent, raw, *_ = agent_with_graph
    body = {"reason": "done", "idempotency_key": "same-key"}
    r1 = await client.post(
        f"/api/v1/agents/{agent.id}/terminate", headers=_h(raw), json=body
    )
    r2 = await client.post(
        f"/api/v1/agents/{agent.id}/terminate", headers=_h(raw), json=body
    )
    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r1.json()["id"] == r2.json()["id"]


async def test_terminate_cross_owner_404(client, agent_with_graph, session):
    agent, _raw, *_ = agent_with_graph
    other = Owner(name="other", token_hash=hash_token("ce_other"))
    session.add(other)
    await session.commit()

    r = await client.post(
        f"/api/v1/agents/{agent.id}/terminate",
        headers={"Authorization": "Bearer ce_other"},
        json={},
    )
    assert r.status_code == 404


async def test_get_job_cross_owner_404(client, agent_with_graph, session):
    agent, raw, *_ = agent_with_graph
    r = await client.post(
        f"/api/v1/agents/{agent.id}/terminate", headers=_h(raw), json={}
    )
    job_id = r.json()["id"]

    other = Owner(name="other2", token_hash=hash_token("ce_other2"))
    session.add(other)
    await session.commit()

    r = await client.get(
        f"/api/v1/terminations/{job_id}",
        headers={"Authorization": "Bearer ce_other2"},
    )
    assert r.status_code == 404