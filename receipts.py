from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from models import Agent, Receipt, TerminationAttempt, TerminationJob
from schemas import ReceiptResult


SCHEMA_VERSION = 1


def canonical_hash(payload: dict[str, Any]) -> str:
    """SHA-256 over sorted, compact, UTF-8 JSON."""
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
    """Construct the immutable receipt payload for a finished job.

    The payload is the single source of truth for what happened. It
    contains no secrets, no signer material, and no raw RPC responses
    beyond sanitized error codes.
    """
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