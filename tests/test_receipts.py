from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import base58
import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import select

from auth import hash_token
from config import get_settings
from models import Agent, Owner, Receipt, TerminationJob
from near import NearRpc, get_rpc
from receipts import canonical_hash
from schemas import JobPhase, JobStatus
from signer import Signer


def _signer(account_id: str, tmp_path) -> Signer:
    seed = bytes.fromhex("c" * 64)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    secret_b58 = "ed25519:" + base58.b58encode(seed + pub).decode()
    pubkey_b58 = "ed25519:" + base58.b58encode(pub).decode()
    p = tmp_path / "pub.json"
    p.write_text(
        json.dumps(
            {
                "account_id": account_id,
                "public_key": pubkey_b58,
                "secret_key": secret_b58,
            }
        )
    )
    return Signer.from_file(str(p))


class MockChain:
    def __init__(self):
        self.receipts: dict[str, dict] = {}
        self.broadcast_mode = "success"
        self.view_fails = False
        self.signers = {}
        self.nonce = 100

    def add_signer_key(self, signer):
        self.signers[signer.public_key] = True


def _handler(chain: MockChain):
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        method = payload.get("method")
        params = payload.get("params") or {}

        if method == "query":
            rt = params.get("request_type")
            if rt == "view_access_key":
                pk = params.get("public_key", "")
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "x",
                        "result": {"nonce": chain.nonce, "permission": "FullAccess"},
                    },
                )
            if rt == "call_function":
                if chain.view_fails:
                    return httpx.Response(
                        200,
                        json={
                            "jsonrpc": "2.0",
                            "id": "x",
                            "error": {"code": -32000, "message": "Server error"},
                        },
                    )
                import base64 as _b64
                args = json.loads(_b64.b64decode(params["args_base64"]).decode())
                rid = args.get("receipt_id", "")
                if params["method_name"] == "get":
                    record = chain.receipts.get(rid)
                    result_bytes = json.dumps(record).encode() if record else b"null"
                    return httpx.Response(
                        200,
                        json={
                            "jsonrpc": "2.0",
                            "id": "x",
                            "result": {
                                "result": list(result_bytes),
                                "logs": [],
                                "block_height": 1,
                                "block_hash": "fake_hash",
                            },
                        },
                    )
                return httpx.Response(
                    200, json={"jsonrpc": "2.0", "id": "x", "result": []}
                )

        if method == "block":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "x",
                    "result": {"header": {"hash": base58.b58encode(b"\xAA" * 32).decode()}},
                },
            )

        if method == "broadcast_tx_commit":
            if chain.broadcast_mode == "fail":
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "x",
                        "result": {
                            "transaction": {"hash": "FAIL_TX"},
                            "status": {"Failure": "custom failure"},
                        },
                    },
                )
            # Success: decode the signed tx, extract args, store receipt.
            import base64 as _b64
            signed = _b64.b64decode(params[0])
            # Very rough: find the JSON args in the tx by scanning for {"
            # In practice we trust the flow; we just need to mimic the
            # contract storing what was submitted.
            # We cheat: mimic what the contract would store by looking
            # at the last N bytes' JSON blob... this is imprecise.
            # Instead, we set a marker the test can populate manually
            # via chain.receipts. Real integration tests use testnet.
            if chain.broadcast_mode == "success_marker":
                # Test populated chain.receipts manually to simulate post-check
                pass
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "x",
                    "result": {
                        "transaction": {"hash": "OK_TX"},
                        "status": {"SuccessValue": ""},
                    },
                },
            )

        return httpx.Response(
            400, json={"jsonrpc": "2.0", "error": {"code": -1}}
        )

    return handler


@pytest.fixture
async def setup(session, monkeypatch, tmp_path):
    monkeypatch.setattr("app._check_near", lambda *a, **k: _ok())

    # Force publisher to be considered configured for these tests.
    settings = get_settings()
    signer = _signer("clean-exit-registry.testnet", tmp_path)
    settings.receipt_contract = "clean-exit-registry.testnet"
    settings.receipt_publisher_account = "clean-exit-registry.testnet"
    settings.receipt_publisher_key_path = str(tmp_path / "pub.json")

    # Owner + agent + finalized receipt
    raw = "ce_owner_receipt_token"
    owner = Owner(name="o", token_hash=hash_token(raw))
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    agent = Agent(owner_id=owner.id, name="a", near_account="alice.testnet", environment="testnet")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    job = TerminationJob(
        agent_id=agent.id, owner_id=owner.id,
        phase=JobPhase.COMPLETE.value, status=JobStatus.SUCCEEDED.value,
        requested_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )
    session.add(job)
    await session.commit()

    payload = {
        "schema_version": 1,
        "agent_id": agent.id,
        "near_account": "alice.testnet",
        "network": "testnet",
        "result": "clean",
        "attempts": [],
    }
    receipt = Receipt(
        agent_id=agent.id,
        agent_near_account="alice.testnet",
        network="testnet",
        requester_id=owner.id,
        result="clean",
        schema_version=1,
        payload=payload,
        payload_hash=canonical_hash(payload),
        verification_status="not_published",
        requested_at=job.requested_at,
        completed_at=job.completed_at,
    )
    session.add(receipt)
    await session.commit()
    await session.refresh(receipt)

    chain = MockChain()
    chain.add_signer_key(signer)

    from app import create_app
    from database import get_session

    app = create_app()

    async def _override_db():
        yield session

    app.dependency_overrides[get_session] = _override_db

    async def _override_rpc():
        return NearRpc("http://test", transport=httpx.MockTransport(_handler(chain)))

    app.dependency_overrides[get_rpc] = _override_rpc

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        c.chain = chain  # type: ignore[attr-defined]
        c.receipt = receipt  # type: ignore[attr-defined]
        c.owner_token = raw  # type: ignore[attr-defined]
        c.signers_account = signer.account_id  # type: ignore[attr-defined]
        yield c


async def _ok():
    return "ok"


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_get_receipt(setup):
    c = setup
    r = await c.get(f"/api/v1/receipts/{c.receipt.id}", headers=_h(c.owner_token))
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == c.receipt.id
    assert data["result"] == "clean"


async def test_get_receipt_not_found(setup):
    c = setup
    r = await c.get("/api/v1/receipts/does-not-exist", headers=_h(c.owner_token))
    assert r.status_code == 404


async def test_get_receipt_cross_owner_404(setup, session):
    c = setup
    other = Owner(name="other-receipt", token_hash=hash_token("ce_other_receipt"))
    session.add(other)
    await session.commit()

    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}",
        headers={"Authorization": "Bearer ce_other_receipt"},
    )
    assert r.status_code == 404


async def test_latest_receipt_for_agent(setup):
    c = setup
    r = await c.get(
        f"/api/v1/agents/{c.receipt.agent_id}/receipt", headers=_h(c.owner_token)
    )
    assert r.status_code == 200
    assert r.json()["id"] == c.receipt.id


async def test_verify_not_published(setup):
    c = setup
    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}/verify", headers=_h(c.owner_token)
    )
    assert r.status_code == 200
    data = r.json()
    assert data["hash_matches"] is True
    assert data["onchain_status"] == "not_published"
    assert data["verified"] is False
    assert "not been published" in " ".join(data["notes"])


async def test_verify_hash_mismatch(setup, session):
    c = setup
    c.receipt.payload = {**c.receipt.payload, "tampered": True}
    await session.commit()

    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}/verify", headers=_h(c.owner_token)
    )
    data = r.json()
    assert data["hash_matches"] is False
    assert data["verified"] is False


async def test_publish_not_configured(setup, monkeypatch):
    c = setup
    settings = get_settings()
    monkeypatch.setattr(settings, "receipt_contract", "")
    r = await c.post(
        f"/api/v1/receipts/{c.receipt.id}/publish", headers=_h(c.owner_token)
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "publisher_unavailable"


async def test_publish_broadcast_failure(setup):
    c = setup
    c.chain.broadcast_mode = "fail"
    r = await c.post(
        f"/api/v1/receipts/{c.receipt.id}/publish", headers=_h(c.owner_token)
    )
    assert r.status_code == 200
    data = r.json()
    assert data["verification_status"] == "verification_failed"
    assert data["onchain_tx_hash"] == "FAIL_TX"


async def test_publish_idempotent_when_published(setup, session):
    c = setup
    c.receipt.verification_status = "published"
    c.receipt.onchain_tx_hash = "EXISTING_TX"
    c.receipt.published_at = datetime.now(timezone.utc)
    await session.commit()

    r = await c.post(
        f"/api/v1/receipts/{c.receipt.id}/publish", headers=_h(c.owner_token)
    )
    assert r.status_code == 200
    data = r.json()
    assert data["verification_status"] == "published"
    assert data["onchain_tx_hash"] == "EXISTING_TX"
    assert "already published" in (data.get("detail") or "")


async def test_verify_queries_chain_when_published(setup, session):
    c = setup
    # Simulate a successful publish: mark DB row + populate chain.
    c.receipt.verification_status = "published"
    c.receipt.onchain_tx_hash = "PUB_TX"
    c.receipt.published_at = datetime.now(timezone.utc)
    await session.commit()

    c.chain.receipts[c.receipt.id] = {
        "receipt_id": c.receipt.id,
        "payload_hash": c.receipt.payload_hash,
        "agent_account": "alice.testnet",
        "schema_version": 1,
        "published_at": int(datetime.now(timezone.utc).timestamp() * 1e9),
    }

    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}/verify", headers=_h(c.owner_token)
    )
    assert r.status_code == 200
    data = r.json()
    assert data["onchain_status"] == "published"
    assert data["onchain_hash"] == c.receipt.payload_hash
    assert data["onchain_matches"] is True
    assert data["verified"] is True


async def test_verify_published_but_chain_missing(setup, session):
    c = setup
    c.receipt.verification_status = "published"
    c.receipt.onchain_tx_hash = "PUB_TX"
    await session.commit()
    # chain.receipts is empty → contract returns null

    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}/verify", headers=_h(c.owner_token)
    )
    data = r.json()
    assert data["onchain_status"] == "verification_failed"
    assert data["verified"] is False
    assert any("not found on chain" in n for n in data["notes"])


async def test_verify_published_but_chain_differs(setup, session):
    c = setup
    c.receipt.verification_status = "published"
    c.receipt.onchain_tx_hash = "PUB_TX"
    await session.commit()

    c.chain.receipts[c.receipt.id] = {
        "receipt_id": c.receipt.id,
        "payload_hash": "b" * 64,  # tampered
        "agent_account": "alice.testnet",
        "schema_version": 1,
        "published_at": 0,
    }

    r = await c.get(
        f"/api/v1/receipts/{c.receipt.id}/verify", headers=_h(c.owner_token)
    )
    data = r.json()
    assert data["onchain_matches"] is False
    assert data["onchain_status"] == "verification_failed"
    assert data["verified"] is False