from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import audit
from auth import require_owner
from config import get_settings
from database import get_session
from errors import ApiError
from models import Agent, Owner, Receipt, TerminationAttempt, TerminationJob
from near import (
    NearError,
    NearRpc,
    build_function_call_transaction,
    get_rpc,
)
from schemas import (
    PublishResult,
    ReceiptRead,
    ReceiptResult,
    ReceiptVerifyResult,
    VerificationStatus,
)
from signer import Signer


router = APIRouter(tags=["receipts"])

SCHEMA_VERSION = 1
PUBLISH_GAS = 30_000_000_000_000   # 30 Tgas


# ---------------------------------------------------------------------------
# Canonical payload (unchanged from Priority 3)
# ---------------------------------------------------------------------------


def canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_payload(
    job: TerminationJob,
    agent: Agent,
    attempts: list[TerminationAttempt],
    result: ReceiptResult,
) -> dict[str, Any]:
    attempt_records = []
    for a in attempts:
        attempt_records.append(
            {
                "authority_id": a.authority_id,
                "action": a.action,
                "status": a.status,
                "tx_hash": a.tx_hash,
                "error": _sanitize_error(a.error),
                "started_at": a.started_at.isoformat(),
                "completed_at": a.completed_at.isoformat() if a.completed_at else None,
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "agent_id": agent.id,
        "near_account": agent.near_account,
        "network": agent.environment,
        "reason": job.reason,
        "requested_at": job.requested_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "result": result.value,
        "scope": {
            "note": (
                "Scope is the set of authorities registered in Clean Exit "
                "for this agent at the time of termination. It does not "
                "claim universal proof that the agent has no rights anywhere."
            ),
            "authority_count": len(attempts),
        },
        "attempts": attempt_records,
    }


def _sanitize_error(error: dict[str, Any] | None) -> dict[str, Any] | None:
    if not error:
        return None
    return {
        "code": error.get("code"),
        "message": str(error.get("message", ""))[:500],
    }


def create_receipt(
    job: TerminationJob,
    agent: Agent,
    attempts: list[TerminationAttempt],
    result: ReceiptResult,
) -> Receipt:
    payload = build_payload(job, agent, attempts, result)
    digest = canonical_hash(payload)
    return Receipt(
        agent_id=agent.id,
        agent_near_account=agent.near_account,
        network=agent.environment,
        requester_id=job.owner_id,
        reason=job.reason,
        result=result.value,
        schema_version=SCHEMA_VERSION,
        payload=payload,
        payload_hash=digest,
        verification_status="not_published",
        requested_at=job.requested_at,
        completed_at=job.completed_at or datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Ownership helper
# ---------------------------------------------------------------------------


async def _owner_receipt(
    receipt_id: str, owner: Owner, session: AsyncSession
) -> Receipt:
    receipt = (
        await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    ).scalar_one_or_none()
    if receipt is None:
        raise ApiError("not_found", "Receipt not found.", status_code=404)
    agent = (
        await session.execute(select(Agent).where(Agent.id == receipt.agent_id))
    ).scalar_one_or_none()
    if agent is None or agent.owner_id != owner.id:
        raise ApiError("not_found", "Receipt not found.", status_code=404)
    return receipt


# ---------------------------------------------------------------------------
# Publish orchestrator
# ---------------------------------------------------------------------------


async def _publish(
    receipt: Receipt,
    signer: Signer,
    rpc: NearRpc,
    session: AsyncSession,
    owner: Owner,
) -> PublishResult:
    """Submit receipt hash to the registry contract. Caller has verified
    publisher config and owner scoping."""
    settings = get_settings()

    # Idempotency: already published → return existing state.
    if receipt.verification_status == VerificationStatus.PUBLISHED.value:
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.PUBLISHED,
            onchain_tx_hash=receipt.onchain_tx_hash,
            published_at=receipt.published_at,
            detail="already published",
        )

    # If a previous attempt left it pending with a tx hash, re-check chain.
    # If the earlier transaction landed, promote instead of resubmitting.
    if (
        receipt.verification_status == VerificationStatus.PENDING.value
        and receipt.onchain_tx_hash
    ):
        if settings.receipt_contract:
            try:
                record = await rpc.view_function_call(
                    settings.receipt_contract, "get", {"receipt_id": receipt.id}
                )
            except NearError:
                record = None
            if record and record.get("payload_hash") == receipt.payload_hash:
                receipt.verification_status = VerificationStatus.PUBLISHED.value
                receipt.published_at = datetime.now(timezone.utc)
                await session.commit()
                return PublishResult(
                    receipt_id=receipt.id,
                    verification_status=VerificationStatus.PUBLISHED,
                    onchain_tx_hash=receipt.onchain_tx_hash,
                    published_at=receipt.published_at,
                    detail="previous publish confirmed on chain",
                )
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.PENDING,
            onchain_tx_hash=receipt.onchain_tx_hash,
            published_at=receipt.published_at,
            detail="previous publish still in flight; chain check inconclusive",
        )

    # Mark pending before submitting so a crash doesn't lose the fact we tried.
    receipt.verification_status = VerificationStatus.PENDING.value
    await session.flush()

    # Fetch nonce + block hash.
    try:
        signer_key = await rpc.get_access_key(
            signer.account_id, signer.public_key
        )
        nonce = int(signer_key["nonce"]) + 1
        block_hash = await rpc.get_latest_block_hash()
    except NearError as e:
        receipt.verification_status = VerificationStatus.VERIFICATION_FAILED.value
        await session.commit()
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.VERIFICATION_FAILED,
            onchain_tx_hash=None,
            published_at=None,
            error=f"cannot prepare tx: {e.message}",
        )

    # Build and broadcast.
    signed = build_function_call_transaction(
        signer=signer,
        receiver_id=settings.receipt_contract,
        method="publish",
        args={
            "receipt_id": receipt.id,
            "payload_hash": receipt.payload_hash,
            "agent_account": receipt.agent_near_account,
            "schema_version": receipt.schema_version,
        },
        gas=PUBLISH_GAS,
        deposit=0,
        nonce=nonce,
        block_hash=block_hash,
    )

    try:
        broadcast = await rpc.broadcast_tx_commit(signed)
    except NearError as e:
        receipt.verification_status = VerificationStatus.VERIFICATION_FAILED.value
        await session.commit()
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.VERIFICATION_FAILED,
            onchain_tx_hash=None,
            published_at=None,
            error=f"broadcast failed: {e.message}",
        )

    if not broadcast["success"]:
        receipt.verification_status = VerificationStatus.VERIFICATION_FAILED.value
        await session.commit()
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.VERIFICATION_FAILED,
            onchain_tx_hash=broadcast["tx_hash"] or None,
            published_at=None,
            error=f"tx failed: {str(broadcast['failure'])[:500]}",
        )

    receipt.onchain_tx_hash = broadcast["tx_hash"]
    await session.flush()

    # Post-check: query the contract to confirm the stored hash matches.
    try:
        onchain = await rpc.view_function_call(
            settings.receipt_contract, "get", {"receipt_id": receipt.id}
        )
    except NearError as e:
        # Tx succeeded but we couldn't verify — report honestly.
        receipt.verification_status = VerificationStatus.PENDING.value
        await session.commit()
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.PENDING,
            onchain_tx_hash=receipt.onchain_tx_hash,
            published_at=None,
            detail=f"tx submitted; post-check failed: {e.message}",
        )

    if not onchain or onchain.get("payload_hash") != receipt.payload_hash:
        receipt.verification_status = VerificationStatus.VERIFICATION_FAILED.value
        await session.commit()
        return PublishResult(
            receipt_id=receipt.id,
            verification_status=VerificationStatus.VERIFICATION_FAILED,
            onchain_tx_hash=receipt.onchain_tx_hash,
            published_at=None,
            error="on-chain hash does not match payload",
        )

    receipt.verification_status = VerificationStatus.PUBLISHED.value
    receipt.published_at = datetime.now(timezone.utc)

    await audit.record(
        session,
        agent_id=receipt.agent_id,
        actor_owner_id=owner.id,
        action="receipt_published",
        target_type="receipt",
        target_id=receipt.id,
        payload={"tx_hash": receipt.onchain_tx_hash},
    )
    await session.commit()

    return PublishResult(
        receipt_id=receipt.id,
        verification_status=VerificationStatus.PUBLISHED,
        onchain_tx_hash=receipt.onchain_tx_hash,
        published_at=receipt.published_at,
        detail="published and confirmed on chain",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/receipts/{receipt_id}", response_model=ReceiptRead)
async def get_receipt(
    receipt_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> ReceiptRead:
    receipt = await _owner_receipt(receipt_id, owner, session)
    return ReceiptRead.model_validate(receipt)


@router.post(
    "/receipts/{receipt_id}/publish",
    response_model=PublishResult,
    status_code=200,
)
async def publish_receipt(
    receipt_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
    rpc: NearRpc = Depends(get_rpc),
) -> PublishResult:
    settings = get_settings()
    allowed, reason = settings.publisher_allowed()
    if not allowed:
        raise ApiError(
            "publisher_unavailable",
            f"receipt publishing unavailable: {reason}",
            status_code=503,
            details={"reason": reason},
        )

    receipt = await _owner_receipt(receipt_id, owner, session)

    signer = Signer.from_file(
        settings.receipt_publisher_key_path,
        expected_account=settings.receipt_publisher_account,
    )
    return await _publish(receipt, signer, rpc, session, owner)


@router.get("/receipts/{receipt_id}/verify", response_model=ReceiptVerifyResult)
async def verify_receipt(
    receipt_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
    rpc: NearRpc = Depends(get_rpc),
) -> ReceiptVerifyResult:
    settings = get_settings()
    receipt = await _owner_receipt(receipt_id, owner, session)

    recomputed = canonical_hash(receipt.payload)
    hash_matches = recomputed == receipt.payload_hash

    onchain_status = VerificationStatus(receipt.verification_status)
    onchain_hash: str | None = None
    onchain_matches: bool | None = None
    notes: list[str] = []

    if not hash_matches:
        notes.append("recomputed hash does not match stored payload_hash")
        onchain_status = VerificationStatus.VERIFICATION_FAILED

    # If we're supposed to have published, ask the chain directly.
    if onchain_status in (
        VerificationStatus.PUBLISHED,
        VerificationStatus.PENDING,
    ):
        if not settings.receipt_contract:
            notes.append("contract not configured in this deployment")
            onchain_status = VerificationStatus.NOT_PUBLISHED
        else:
            try:
                record = await rpc.view_function_call(
                    settings.receipt_contract, "get", {"receipt_id": receipt.id}
                )
            except NearError as e:
                notes.append(f"chain query failed: {e.message}")
                record = None

            if record is None:
                if onchain_status == VerificationStatus.PENDING:
                    notes.append("receipt not yet visible on chain; still pending")
                else:
                    notes.append("receipt not found on chain despite published status")
                    onchain_status = VerificationStatus.VERIFICATION_FAILED
            else:
                onchain_hash = record.get("payload_hash")
                onchain_matches = onchain_hash == receipt.payload_hash
                if not onchain_matches:
                    notes.append("on-chain hash does not match stored payload_hash")
                    onchain_status = VerificationStatus.VERIFICATION_FAILED
                else:
                    if onchain_status == VerificationStatus.PENDING:
                        receipt.verification_status = VerificationStatus.PUBLISHED.value
                        receipt.published_at = datetime.now(timezone.utc)
                        await session.commit()
                        notes.append("pending publish resolved to published")
                    onchain_status = VerificationStatus.PUBLISHED
    elif onchain_status == VerificationStatus.NOT_PUBLISHED:
        notes.append("receipt has not been published on chain")

    verified = (
        hash_matches
        and onchain_status == VerificationStatus.PUBLISHED
        and onchain_matches is True
    )

    return ReceiptVerifyResult(
        receipt_id=receipt.id,
        payload_hash=receipt.payload_hash,
        recomputed_hash=recomputed,
        hash_matches=hash_matches,
        onchain_status=onchain_status,
        onchain_tx_hash=receipt.onchain_tx_hash,
        onchain_hash=onchain_hash,
        onchain_matches=onchain_matches,
        verified=verified,
        notes=notes,
    )


@router.get("/agents/{agent_id}/receipt", response_model=ReceiptRead)
async def latest_agent_receipt(
    agent_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> ReceiptRead:
    # Verify agent belongs to owner (defense in depth before query).
    agent = (
        await session.execute(select(Agent).where(Agent.id == agent_id))
    ).scalar_one_or_none()
    if agent is None or agent.owner_id != owner.id:
        raise ApiError("not_found", "Agent not found.", status_code=404)

    receipt = (
        await session.execute(
            select(Receipt)
            .where(Receipt.agent_id == agent_id)
            .order_by(Receipt.completed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if receipt is None:
        raise ApiError(
            "not_found",
            "No finalized receipt for this agent yet.",
            status_code=404,
        )
    return ReceiptRead.model_validate(receipt)