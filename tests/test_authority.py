from __future__ import annotations

import httpx
import pytest

from auth import hash_token
from models import Agent, Authority, Owner


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
async def owner_a(session):
    raw = "ce_owner_a_token"
    o = Owner(name="owner-a", token_hash=hash_token(raw))
    session.add(o)
    await session.commit()
    await session.refresh(o)
    return o, raw


@pytest.fixture
async def owner_b(session):
    raw = "ce_owner_b_token"
    o = Owner(name="owner-b", token_hash=hash_token(raw))
    session.add(o)
    await session.commit()
    await session.refresh(o)
    return o, raw


@pytest.fixture
async def agent_a(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents", headers={"Authorization": f"Bearer {raw}"}, json={"name": "a"}
    )
    assert r.status_code == 201
    return r.json(), raw


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


async def test_create_authority(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "near_function_key",
            "provider": "near",
            "resource": "ed25519:ABC",
            "revocable": True,
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["state"] == "unverified"  # honest default
    assert data["source"] == "registered"
    assert data["parent_id"] is None


async def test_create_authority_with_parent(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "near_function_key",
            "provider": "near",
            "resource": "ed25519:PARENT",
        },
    )
    parent_id = r.json()["id"]

    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "child_delegation",
            "provider": "clean",
            "resource": "child-1",
            "parent_id": parent_id,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["parent_id"] == parent_id


async def test_create_authority_invalid_parent(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "child_delegation",
            "provider": "clean",
            "resource": "orphan",
            "parent_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_parent"


async def test_create_authority_cross_agent_parent(
    client, owner_a, owner_b, session
):
    """Parent belongs to a different agent → 400 invalid_parent."""
    _oa, raw_a = owner_a
    _ob, raw_b = owner_b

    r = await client.post("/api/v1/agents", headers=_auth(raw_a), json={"name": "a1"})
    agent_a_id = r.json()["id"]
    r = await client.post("/api/v1/agents", headers=_auth(raw_a), json={"name": "a2"})
    agent_a2_id = r.json()["id"]

    r = await client.post(
        f"/api/v1/agents/{agent_a_id}/authorities",
        headers=_auth(raw_a),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    parent_id = r.json()["id"]

    r = await client.post(
        f"/api/v1/agents/{agent_a2_id}/authorities",
        headers=_auth(raw_a),
        json={
            "type": "child_delegation",
            "provider": "clean",
            "resource": "x",
            "parent_id": parent_id,
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_parent"


async def test_create_authority_cross_owner(client, agent_a, owner_b):
    agent, _ = agent_a
    _ob, raw_b = owner_b
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw_b),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    assert r.status_code == 404


async def test_get_authority(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    auth_id = r.json()["id"]

    r = await client.get(f"/api/v1/authorities/{auth_id}", headers=_auth(raw))
    assert r.status_code == 200
    assert r.json()["id"] == auth_id


async def test_get_authority_cross_owner_404(client, agent_a, owner_b):
    agent, raw = agent_a
    _ob, raw_b = owner_b
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    auth_id = r.json()["id"]

    r = await client.get(f"/api/v1/authorities/{auth_id}", headers=_auth(raw_b))
    assert r.status_code == 404


async def test_patch_authority(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    auth_id = r.json()["id"]

    r = await client.patch(
        f"/api/v1/authorities/{auth_id}",
        headers=_auth(raw),
        json={"revocable": True, "scope": {"method": "transfer"}, "meta": {"note": "x"}},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["revocable"] is True
    assert data["scope"] == {"method": "transfer"}
    assert data["meta"] == {"note": "x"}


async def test_patch_rejects_parent_id(client, agent_a):
    """parent_id is structural — not updateable via PATCH."""
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "K"},
    )
    auth_id = r.json()["id"]

    r = await client.patch(
        f"/api/v1/authorities/{auth_id}",
        headers=_auth(raw),
        json={"parent_id": "anything"},
    )
    assert r.status_code == 422  # StrictModel forbids unknown fields


async def test_graph_nested(client, agent_a):
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "P"},
    )
    p = r.json()["id"]
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "child_delegation",
            "provider": "clean",
            "resource": "C",
            "parent_id": p,
        },
    )
    c = r.json()["id"]
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={
            "type": "obligation",
            "provider": "near",
            "resource": "G",
            "parent_id": c,
        },
    )

    r = await client.get(
        f"/api/v1/agents/{agent['id']}/authorities", headers=_auth(raw)
    )
    assert r.status_code == 200
    graph = r.json()
    assert len(graph["roots"]) == 1
    root = graph["roots"][0]
    assert root["authority"]["id"] == p
    assert len(root["children"]) == 1
    assert root["children"][0]["authority"]["id"] == c
    assert len(root["children"][0]["children"]) == 1


async def test_graph_orphaned_child(client, agent_a, session):
    """Child whose parent points at a deleted row → orphaned list."""
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "P"},
    )
    p = r.json()["id"]

    # Insert a child whose parent_id points at a nonexistent id, bypassing API.
    orphan = Authority(
        agent_id=agent["id"],
        parent_id="does-not-exist",
        type="child_delegation",
        provider="clean",
        resource="orphan",
        state="active",
    )
    session.add(orphan)
    await session.commit()

    r = await client.get(
        f"/api/v1/agents/{agent['id']}/authorities", headers=_auth(raw)
    )
    graph = r.json()
    assert len(graph["orphaned"]) == 1
    assert graph["orphaned"][0]["resource"] == "orphan"
    assert len(graph["roots"]) == 1  # P is the only natural root


async def test_graph_handles_self_cycle(client, agent_a, session):
    """Corrupt data: parent_id points at itself. Graph must not crash."""
    agent, raw = agent_a
    r = await client.post(
        f"/api/v1/agents/{agent['id']}/authorities",
        headers=_auth(raw),
        json={"type": "near_function_key", "provider": "near", "resource": "P"},
    )
    p = r.json()["id"]

    # Create a self-loop directly in the DB.
    corrupt = Authority(
        agent_id=agent["id"],
        parent_id=p,
        type="child_delegation",
        provider="clean",
        resource="self-loop",
        state="active",
    )
    session.add(corrupt)
    await session.commit()
    # Now point P at corrupt — creating a cycle P → corrupt → P.
    await session.execute(
        __import__("sqlalchemy").text(
            "UPDATE authorities SET parent_id = :cid WHERE id = :pid"
        ),
        {"cid": corrupt.id, "pid": p},
    )
    await session.commit()

    # Must not crash; must return something.
    r = await client.get(
        f"/api/v1/agents/{agent['id']}/authorities", headers=_auth(raw)
    )
    assert r.status_code == 200


async def test_would_create_cycle_detects_self(session):
    from authority import would_create_cycle

    owner = Owner(name="x", token_hash=hash_token("ce_x"))
    session.add(owner)
    await session.commit()
    agent = Agent(owner_id=owner.id, name="a", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    a = Authority(
        agent_id=agent.id, type="near_function_key", provider="near",
        resource="A", state="active",
    )
    session.add(a)
    await session.commit()
    await session.refresh(a)

    assert await would_create_cycle(session, a.id, a.id) is True
    assert await would_create_cycle(session, a.id, None) is False