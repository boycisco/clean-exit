from __future__ import annotations

from datetime import datetime, timedelta, timezone

import base58
import json

import httpx

import pytest

from auth import hash_token
from config import get_settings
from jobs import claim_next_job, recover_stale_jobs, run_job
from models import Agent, Authority, Owner, TerminationJob
from schemas import JobPhase, JobStatus


async def _mk(session):
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

    auth = Authority(
        agent_id=agent.id,
        type="obligation",
        provider="near",
        resource="pending-1",
        state="active",
    )
    session.add(auth)
    await session.commit()
    await session.refresh(auth)

    job = TerminationJob(
        agent_id=agent.id,
        owner_id=owner.id,
        phase=JobPhase.VALIDATE.value,
        status=JobStatus.PENDING.value,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return owner, agent, auth, job


async def test_claim_pending_job(session):
    _o, _a, _au, job = await _mk(session)
    claimed = await claim_next_job(session, worker_id="w1")
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.locked_by == "w1"
    assert claimed.status == JobStatus.RUNNING.value


async def test_claim_returns_none_when_locked(session):
    _o, _a, _au, _job = await _mk(session)
    first = await claim_next_job(session, worker_id="w1")
    assert first is not None
    second = await claim_next_job(session, worker_id="w2")
    assert second is None


async def test_recover_stale_job(session):
    _o, _a, _au, job = await _mk(session)
    job.status = JobStatus.RUNNING.value
    job.locked_by = "dead-worker"
    job.locked_at = datetime.now(timezone.utc) - timedelta(
        seconds=get_settings().worker_stale_seconds + 10
    )
    await session.commit()

    count = await recover_stale_jobs(session)
    assert count == 1
    await session.refresh(job)
    assert job.status == JobStatus.PENDING.value
    assert job.locked_by is None


async def test_run_job_without_signer_aborts(session):
    """A job that hits the revoke phase without a signer must FAIL, not crash."""
    _o, _a, _au, job = await _mk(session)
    job.status = JobStatus.RUNNING.value
    job.locked_by = "w1"
    await session.commit()
    await session.refresh(job)

    await run_job(session, job)
    await session.refresh(job)
    assert job.status == JobStatus.FAILED.value
    assert job.error is not None
    assert job.error.get("code") == "phase_abort"


async def test_retry_counter_increments_on_failure(session, monkeypatch):
    """Force a phase handler to raise — job should increment retry_count."""
    _o, _a, _au, job = await _mk(session)
    job.status = JobStatus.RUNNING.value
    job.locked_by = "w1"
    await session.commit()
    await session.refresh(job)

    async def boom(session, job, agent):
        raise RuntimeError("synthetic failure")

    import termination as t

    monkeypatch.setitem(t.PHASE_HANDLERS, JobPhase.INVENTORY, boom)

    await run_job(session, job)
    await session.refresh(job)
    assert job.retry_count == 1
    assert job.status == JobStatus.PENDING.value
    assert job.next_attempt_at is not None
    assert job.next_attempt_at > datetime.now(timezone.utc)


def _make_signer(account_id: str):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from signer import Signer
    import tempfile
    import pathlib

    seed = bytes.fromhex("b" * 64)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    secret_b58 = "ed25519:" + base58.b58encode(seed + pub).decode()
    pubkey_b58 = "ed25519:" + base58.b58encode(pub).decode()

    p = pathlib.Path(tempfile.mkdtemp()) / "signer.json"
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


def _mock_chain_handler(chain: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        method = payload.get("method")
        params = payload.get("params") or {}

        if method == "query":
            rt = params.get("request_type")
            if rt == "view_access_key_list":
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": "x",
                        "result": {
                            "keys": [
                                {"public_key": pk, "access_key": info}
                                for pk, info in chain["keys"].items()
                            ]
                        },
                    },
                )
            if rt == "view_access_key":
                pk = params.get("public_key", "")
                if pk in chain["keys"]:
                    return httpx.Response(
                        200,
                        json={
                            "jsonrpc": "2.0",
                            "id": "x",
                            "result": {
                                "nonce": 10,
                                "permission": "FullAccess",
                                "public_key": pk,
                            },
                        },
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
            to_remove = [
                pk
                for pk, info in chain["keys"].items()
                if info.get("permission") != "FullAccess"
            ]
            for pk in to_remove:
                del chain["keys"][pk]
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": "x",
                    "result": {
                        "transaction": {"hash": "END2END_TX"},
                        "status": {"SuccessValue": ""},
                    },
                },
            )

        return httpx.Response(
            400, json={"jsonrpc": "2.0", "error": {"code": -1}}
        )

    return handler


async def test_end_to_end_clean_termination(session, monkeypatch):
    """Full loop: job claimed → phases run → real revoke (mocked RPC) →
    receipt created → agent clean → job succeeded."""
    from near import NearRpc
    from receipts import canonical_hash
    from models import Receipt, TerminationAttempt
    from sqlalchemy import select
    import termination as term

    # Setup: agent with a single function-call authority.
    # Public key must be a valid 32-byte ed25519 key — a short string like
    # "ed25519:TARGET" would fail _pubkey_bytes() in near.py.
    _o, agent, authority, job = await _mk(session)
    target_pubkey = "ed25519:" + base58.b58encode(b"\x07" * 32).decode()
    authority.type = "near_function_key"
    authority.resource = target_pubkey
    authority.state = "active"
    await session.commit()

    # Build a mock signer + chain: FullAccess signer key + FunctionCall target.
    signer = _make_signer("alice.testnet")
    chain = {
        "keys": {
            signer.public_key: {"permission": "FullAccess"},
            target_pubkey: {"permission": {"FunctionCall": {"receiver_id": "testnet"}}},
        }
    }

    def _rpc():
        return NearRpc(
            "http://test",
            transport=httpx.MockTransport(_mock_chain_handler(chain)),
        )

    def fake_support(t):
        if t.value == "near_function_key":
            return ("supported", "signer", "verify")
        if t.value == "child_delegation":
            return ("supported", "registry", "verify")
        return ("unsupported", None, "manual")

    monkeypatch.setattr(term, "_support_for_type", fake_support)
    monkeypatch.setattr(term, "get_rpc", _rpc)
    monkeypatch.setattr(term, "require_signer", lambda: signer)

    job.status = "running"
    job.locked_by = "w1"
    await session.commit()
    await session.refresh(job)

    await run_job(session, job)
    await session.refresh(job)

    assert job.status == "succeeded", f"job failed: {job.error}"
    assert job.receipt_id is not None
    assert job.completed_at is not None

    await session.refresh(agent)
    assert agent.status == "clean"

    attempts = (
        await session.execute(
            select(TerminationAttempt).where(TerminationAttempt.job_id == job.id)
        )
    ).scalars().all()
    assert len(attempts) == 1
    assert attempts[0].status == "revoked"
    assert attempts[0].tx_hash == "END2END_TX"

    receipt = (
        await session.execute(select(Receipt).where(Receipt.id == job.receipt_id))
    ).scalar_one()
    assert receipt.result == "clean"
    assert receipt.payload["result"] == "clean"
    assert len(receipt.payload_hash) == 64
    assert canonical_hash(receipt.payload) == receipt.payload_hash

    # Chain confirms target key was removed, signer key survived.
    assert target_pubkey not in chain["keys"]
    assert signer.public_key in chain["keys"]