from __future__ import annotations

import json

import httpx
import pytest

from auth import hash_token
from models import Agent, Authority, Owner
from near import NearRpc, get_rpc


def _make_handler(account_exists: bool, keys: list[str]):
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        params = payload.get("params", {})
        request_type = params.get("request_type") if isinstance(params, dict) else None

        if request_type == "view_account":
            if not account_exists:
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "clean",
                        "error": {
                            "code": -32000,
                            "message": "Server error",
                            "data": {
                                "name": "HANDLER_ERROR",
                                "cause": {
                                    "name": "UNKNOWN_ACCOUNT",
                                    "info": {"account_id": params.get("account_id")},
                                },
                            },
                        },
                    },
                )
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": "clean",
                      "result": {"amount": "0", "code_hash": "11111"}},
            )

        if request_type == "view_access_key_list":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "clean",
                    "result": {
                        "keys": [
                            {"public_key": k, "access_key": {"permission": "FullAccess"}}
                            for k in keys
                        ]
                    },
                },
            )

        return httpx.Response(
            400,
            json={"jsonrpc": "2.0", "id": "clean",
                  "error": {"code": -1, "message": "unknown"}},
        )

    return handler


@pytest.fixture
async def client(session, monkeypatch):
    async def fake_near(rpc_url: str) -> str:
        return "ok"

    monkeypatch.setattr("app._check_near", fake_near)

    from app import create_app
    from database import get_session

    application = create_app()

    async def _override_db():
        yield session

    application.dependency_overrides[get_session] = _override_db

    holder = {"transport": httpx.MockTransport(_make_handler(False, []))}

    def _rpc_override():
        return NearRpc("http://test", transport=holder["transport"])

    application.dependency_overrides[get_rpc] = _rpc_override

    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        c._holder = holder  # type: ignore[attr-defined]
        yield c


@pytest.fixture
async def setup(session, client):
    raw = "ce_owner_token"
    owner = Owner(name="o", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    agent = Agent(
        owner_id=owner.id,
        name="a",
        near_account="alice.testnet",
        environment="testnet",
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    present = Authority(
        agent_id=agent.id, type="near_function_key", provider="near",
        resource="ed25519:PRESENT", state="unverified",
    )
    absent = Authority(
        agent_id=agent.id, type="near_function_key", provider="near",
        resource="ed25519:ABSENT", state="unverified",
    )
    obligation = Authority(
        agent_id=agent.id, type="obligation", provider="near",
        resource="pending-1", state="active",
    )
    session.add_all([present, absent, obligation])
    await session.commit()
    for row in (present, absent, obligation):
        await session.refresh(row)

    return owner, raw, agent, present, absent, obligation


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


async def test_verify_present_key_active(client, setup):
    _owner, raw, agent, present, absent, obligation = setup
    client._holder["transport"] = httpx.MockTransport(
        _make_handler(True, ["ed25519:PRESENT"])
    )

    r = await client.post(f"/api/v1/agents/{agent.id}/verify", headers=_auth(raw))
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["account_exists"] is True
    assert data["total_observed_keys"] == 1
    assert data["error"] is None

    verified_ids = {v["authority_id"]: v for v in data["verified"]}
    assert verified_ids[present.id]["new_state"] == "active"
    assert verified_ids[present.id]["on_chain"] is True
    assert verified_ids[absent.id]["new_state"] == "expired"
    assert verified_ids[absent.id]["on_chain"] is False

    skipped_ids = {s["authority_id"] for s in data["skipped"]}
    assert obligation.id in skipped_ids


async def test_verify_account_not_found(client, setup):
    _owner, raw, agent, present, absent, obligation = setup
    client._holder["transport"] = httpx.MockTransport(_make_handler(False, []))

    r = await client.post(f"/api/v1/agents/{agent.id}/verify", headers=_auth(raw))
    assert r.status_code == 200
    data = r.json()

    assert data["account_exists"] is False
    assert data["error"] is not None
    assert data["verified"] == []
    skipped_ids = {s["authority_id"] for s in data["skipped"]}
    assert present.id in skipped_ids
    assert absent.id in skipped_ids


async def test_verify_no_near_account(client, setup, session):
    _owner, raw, agent, present, absent, obligation = setup
    agent.near_account = None
    await session.commit()

    r = await client.post(f"/api/v1/agents/{agent.id}/verify", headers=_auth(raw))
    assert r.status_code == 200
    data = r.json()
    assert data["account_exists"] is False
    assert data["error"] is not None
    assert "no near_account" in data["error"]


async def test_verify_requires_auth(client, setup):
    _owner, _raw, agent, *_ = setup
    r = await client.post(f"/api/v1/agents/{agent.id}/verify")
    assert r.status_code == 401


async def test_verify_cross_owner_404(client, setup, session):
    from auth import hash_token
    from models import Owner

    _owner, _raw, agent, *_ = setup

    # Create a real second owner — an unknown token returns 401, not 404,
    # so we need a valid token from a *different* owner to exercise the
    # 404 path that require_agent_owner produces on cross-owner access.
    other_raw = "ce_other_owner_token_for_verify"
    other = Owner(name="other-verify-owner", token_hash=hash_token(other_raw))
    session.add(other)
    await session.commit()

    r = await client.post(
        f"/api/v1/agents/{agent.id}/verify",
        headers={"Authorization": f"Bearer {other_raw}"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


async def test_verify_updates_last_verified_at(client, setup, session):
    _owner, raw, agent, present, absent, _obligation = setup
    client._holder["transport"] = httpx.MockTransport(
        _make_handler(True, ["ed25519:PRESENT"])
    )

    r = await client.post(f"/api/v1/agents/{agent.id}/verify", headers=_auth(raw))
    assert r.status_code == 200

    await session.refresh(present)
    await session.refresh(absent)
    assert present.last_verified_at is not None
    assert absent.last_verified_at is not None
    assert present.state == "active"
    assert absent.state == "expired"


async def test_verify_keys_unavailable_does_not_fabricate_expired(
    client, setup
):
    """If view_account succeeds but get_access_keys fails, no key may be
    marked expired — we cannot claim absence without a real key list."""
    _owner, raw, agent, present, absent, obligation = setup

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        params = payload.get("params", {})
        request_type = params.get("request_type") if isinstance(params, dict) else None

        if request_type == "view_account":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": "clean",
                      "result": {"amount": "0", "code_hash": "11111"}},
            )
        if request_type == "view_access_key_list":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": "clean",
                      "error": {"code": -32000, "message": "Server error"}},
            )
        return httpx.Response(400, json={"error": {"code": -1}})

    client._holder["transport"] = httpx.MockTransport(handler)

    r = await client.post(f"/api/v1/agents/{agent.id}/verify", headers=_auth(raw))
    assert r.status_code == 200
    data = r.json()

    assert data["account_exists"] is True
    assert data["error"] is not None
    assert "access key list failed" in data["error"]

    # NOTHING may be verified (i.e., no fabricated 'expired').
    assert data["verified"] == []
    skipped_ids = {s["authority_id"] for s in data["skipped"]}
    assert present.id in skipped_ids
    assert absent.id in skipped_ids
    # States must be unchanged on the models.
    for s in data["skipped"]:
        assert s["new_state"] == s["previous_state"]