from __future__ import annotations

import base58
import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from auth import hash_token
from models import Agent, Authority, Owner
from near import NearRpc, get_rpc
from signer import Signer


# ---------------------------------------------------------------------------
# Stateful mock RPC
# ---------------------------------------------------------------------------

class MockChain:
    def __init__(self):
        self.keys: dict[str, dict] = {}
        self.nonce = 10
        self.broadcast_mode = "success"  # success | failure | rpc_error
        self.broadcast_removes_key = True
        self.list_keys_fails = False
        self.signers: dict[str, str] = {}  # account -> public_key for own key


def _make_handler(chain: MockChain):
    def handler(request: httpx.Request) -> httpx.Response:
        payload = __import__("json").loads(request.content)
        method = payload.get("method")
        params = payload.get("params")

        if method == "query":
            p = params if isinstance(params, dict) else {}
            rt = p.get("request_type")
            account = p.get("account_id", "")

            if rt == "view_access_key_list":
                if chain.list_keys_fails:
                    return httpx.Response(
                        200,
                        json={
                            "jsonrpc": "2.0",
                            "id": "clean",
                            "error": {"code": -32000, "message": "Server error"},
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "clean",
                        "result": {
                            "keys": [
                                {"public_key": pk, "access_key": info}
                                for pk, info in chain.keys.items()
                            ]
                        },
                    },
                )

            if rt == "view_access_key":
                pk = p.get("public_key", "")
                if pk in chain.keys:
                    return httpx.Response(
                        200,
                        json={
                            "jsonrpc": "2.0",
                            "id": "clean",
                            "result": {
                                "nonce": chain.nonce,
                                "permission": chain.keys[pk].get("permission", "FullAccess"),
                                "public_key": pk,
                            },
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "clean",
                        "error": {
                            "code": -32000,
                            "message": "Server error",
                            "data": f"access key {pk} does not exist while viewing",
                        },
                    },
                )

        if method == "block":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "clean",
                    "result": {
                        "header": {"hash": base58.b58encode(b"\xAA" * 32).decode()}
                    },
                },
            )

        if method == "broadcast_tx_commit":
            if chain.broadcast_mode == "rpc_error":
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "clean",
                        "error": {"code": -32000, "message": "Invalid transaction"},
                    },
                )
            if chain.broadcast_mode == "failure":
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "clean",
                        "result": {
                            "transaction": {"hash": "FAKE_FAIL_TX"},
                            "status": {
                                "Failure": {
                                    "ActionError": {
                                        "index": 0,
                                        "kind": {"DeleteKeyError": {}},
                                    }
                                }
                            },
                        },
                    },
                )
            # success — if configured, actually remove the target key
            if chain.broadcast_removes_key:
                # naive: remove any non-FullAccess key (the target).
                to_remove = [
                    pk
                    for pk, info in chain.keys.items()
                    if info.get("permission") != "FullAccess"
                ]
                for pk in to_remove:
                    del chain.keys[pk]
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "clean",
                    "result": {
                        "transaction": {"hash": "FAKE_OK_TX"},
                        "status": {"SuccessValue": ""},
                    },
                },
            )

        return httpx.Response(
            400,
            json={"jsonrpc": "2.0", "id": "clean",
                  "error": {"code": -1, "message": "unknown method"}},
        )

    return handler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _write_signer(tmp_path, account_id: str) -> Signer:
    seed = bytes.fromhex("a" * 64)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    secret_b58 = "ed25519:" + base58.b58encode(seed + pub).decode()
    p = tmp_path / "signer.json"
    p.write_text(
        f'{{"account_id": "{account_id}", "public_key": "ed25519:placeholder", '
        f'"secret_key": "{secret_b58}"}}'
    )
    return Signer.from_file(str(p))


@pytest.fixture
async def setup(session, monkeypatch):
    monkeypatch.setattr("app._check_near", lambda *a, **k: _ok_near())

    from app import create_app
    from database import get_session
    from config import get_settings

    app = create_app()

    async def _override_db():
        yield session

    app.dependency_overrides[get_session] = _override_db

    chain = MockChain()

    async def _get_rpc_override():
        return NearRpc("http://test", transport=httpx.MockTransport(_make_handler(chain)))

    app.dependency_overrides[get_rpc] = _get_rpc_override

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        # Create owner, agent, and an authority.
        raw = "ce_owner_token"
        owner = Owner(name="owner", token_hash=hash_token(raw))
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

        target_pub = "ed25519:" + base58.b58encode(b"\x01" * 32).decode()
        auth_row = Authority(
            agent_id=agent.id,
            type="near_function_key",
            provider="near",
            resource=target_pub,
            state="active",
        )
        session.add(auth_row)
        await session.commit()
        await session.refresh(auth_row)

        # Signer setup
        signer = _write_signer(monkeypatch.context().tmp_path if False else __import__("pathlib").Path(str(__import__("tempfile").mkdtemp())), "alice.testnet")

        # Populate the chain with signer's key and target key
        chain.keys[signer.public_key] = {"permission": "FullAccess"}
        chain.keys[target_pub] = {
            "permission": {"FunctionCall": {"receiver_id": "x.near", "method_names": [], "allowance": None}}
        }
        chain.signers["alice.testnet"] = signer.public_key

        # Override signing to be allowed with this signer
        settings = get_settings()
        settings.near_signer_account = "alice.testnet"
        settings.near_signer_key_path = signer.__dict__.get("_path", "/tmp/x")

        # Easier: patch require_signer directly for auth via dependency override.
        from signer import require_signer as real_require
        app.dependency_overrides[real_require] = lambda: signer

        c.chain = chain
        c.agent = agent
        c.authority = auth_row
        c.owner_token = raw
        c.signer = signer
        c.target_pub = target_pub
        yield c


def _ok_near():
    async def _f():
        return "ok"
    return _f()


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_revoke_happy_path(setup):
    c = setup
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["outcome"] == "revoked"
    assert data["new_state"] == "revoked"
    assert data["tx_hash"] == "FAKE_OK_TX"
    assert data["verified_absent"] is True


async def test_revoke_already_absent(setup):
    c = setup
    # Remove the target key before the call.
    del c.chain.keys[c.target_pub]
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["outcome"] == "already_absent"
    assert data["new_state"] == "expired"
    assert data["tx_hash"] is None


async def test_revoke_unauthorized(setup):
    c = setup
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
    )
    assert r.status_code == 401


async def test_revoke_not_found_authority(setup):
    c = setup
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/does-not-exist/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 404


async def test_revoke_not_active(setup, session):
    c = setup
    c.authority.state = "revoked"
    await session.commit()
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "not_active"


async def test_revoke_wrong_type(setup, session):
    c = setup
    c.authority.type = "scheduled_job"
    await session.commit()
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "unsupported_type"


async def test_revoke_submitted_but_failed(setup):
    c = setup
    c.chain.broadcast_mode = "failure"
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["outcome"] == "submitted_but_failed"
    assert data["new_state"] == "failed"
    assert data["tx_hash"] == "FAKE_FAIL_TX"


async def test_revoke_requires_manual_action_on_post_check_fail(setup):
    c = setup
    c.chain.broadcast_removes_key = False  # tx succeeded but key not removed
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["outcome"] == "requires_manual_action"
    assert data["verified_absent"] is False


async def test_revoke_pre_check_rpc_fails(setup):
    c = setup
    c.chain.list_keys_fails = True
    r = await c.post(
        f"/api/v1/agents/{c.agent.id}/authorities/{c.authority.id}/revoke",
        headers=_h(c.owner_token),
    )
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "rpc_unavailable"