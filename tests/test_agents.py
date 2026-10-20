from __future__ import annotations

import httpx
import pytest

from auth import hash_token
from models import Owner


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


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


async def test_create_agent(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents",
        headers=_auth(raw),
        json={"name": "tmp", "near_account": "alice.testnet"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["name"] == "tmp"
    assert data["near_account"] == "alice.testnet"
    assert data["status"] == "active"
    assert data["environment"] == "testnet"


async def test_create_agent_rejects_bad_account(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents",
        headers=_auth(raw),
        json={"name": "x", "near_account": "Alice.Testnet"},
    )
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error"


async def test_create_agent_requires_auth(client):
    r = await client.post("/api/v1/agents", json={"name": "x"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


async def test_list_agents_scoped_to_owner(client, owner_a, owner_b):
    _oa, raw_a = owner_a
    _ob, raw_b = owner_b

    for name in ("a1", "a2"):
        await client.post(
            "/api/v1/agents", headers=_auth(raw_a), json={"name": name}
        )
    await client.post(
        "/api/v1/agents", headers=_auth(raw_b), json={"name": "b1"}
    )

    r_a = await client.get("/api/v1/agents", headers=_auth(raw_a))
    r_b = await client.get("/api/v1/agents", headers=_auth(raw_b))
    assert r_a.status_code == 200
    assert r_b.status_code == 200
    assert {x["name"] for x in r_a.json()} == {"a1", "a2"}
    assert {x["name"] for x in r_b.json()} == {"b1"}


async def test_list_agents_status_filter(client, owner_a):
    _owner, raw = owner_a
    await client.post("/api/v1/agents", headers=_auth(raw), json={"name": "one"})
    r = await client.get(
        "/api/v1/agents", headers=_auth(raw), params={"status": "clean"}
    )
    assert r.status_code == 200
    assert r.json() == []  # no clean agents yet


async def test_get_agent_cross_owner_404(client, owner_a, owner_b):
    _oa, raw_a = owner_a
    _ob, raw_b = owner_b
    r = await client.post(
        "/api/v1/agents", headers=_auth(raw_a), json={"name": "private"}
    )
    agent_id = r.json()["id"]

    r = await client.get(f"/api/v1/agents/{agent_id}", headers=_auth(raw_b))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


async def test_patch_agent(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents", headers=_auth(raw), json={"name": "orig"}
    )
    agent_id = r.json()["id"]

    r = await client.patch(
        f"/api/v1/agents/{agent_id}",
        headers=_auth(raw),
        json={"name": "renamed", "description": "desc"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "renamed"
    assert data["description"] == "desc"
    assert data["near_account"] is None


async def test_patch_ignores_unknown_field(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents", headers=_auth(raw), json={"name": "x"}
    )
    agent_id = r.json()["id"]

    r = await client.patch(
        f"/api/v1/agents/{agent_id}",
        headers=_auth(raw),
        json={"status": "clean"},  # not a valid AgentUpdate field
    )
    assert r.status_code == 422


async def test_authorities_graph_empty(client, owner_a):
    _owner, raw = owner_a
    r = await client.post(
        "/api/v1/agents", headers=_auth(raw), json={"name": "x"}
    )
    agent_id = r.json()["id"]
    r = await client.get(
        f"/api/v1/agents/{agent_id}/authorities", headers=_auth(raw)
    )
    assert r.status_code == 200
    assert r.json() == {"agent_id": agent_id, "roots": [], "orphaned": []}