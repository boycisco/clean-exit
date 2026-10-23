from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import audit
from auth import require_agent_owner, require_owner
from config import get_settings
from database import get_session
from errors import ApiError
from models import Agent as AgentModel
from models import Authority as AuthorityModel
from models import Owner, TerminationAttempt, TerminationJob
from schemas import (
    AuthorityState,
    AuthorityType,
    Environment,
    JobPhase,
    JobStatus,
    PlanStep,
    TerminationJobRead,
    TerminationPlan,
    TerminationRequest,
    ReceiptResult,
    RevokeOutcome,
)

from near import NearError, NearRpcUnavailable, get_rpc
from receipts import create_receipt
from signer import Signer, require_signer
from authority import execute_revoke_authority

router = APIRouter(tags=["termination"])

TRANSIENT_CODES = {
    "rpc_unavailable",
    "signer_key_missing",
}
PERMANENT_CODES = {
    "unsupported_type",
    "not_active",
    "self_revocation_refused",
    "signer_cannot_revoke",
    "no_near_account",
    "signer_unavailable",
    "signer_invalid",
}

# ---------------------------------------------------------------------------
# Planner (read-only)
# ---------------------------------------------------------------------------

def _support_for_type(t: AuthorityType) -> tuple[str, str | None, str]:
    """Return (support, required_authorization, verification_procedure)."""
    settings = get_settings()
    if t == AuthorityType.NEAR_FUNCTION_KEY:
        can_sign, reason = settings.signing_allowed()
        if can_sign:
            return (
                "supported",
                "FullAccess signer on the agent account",
                "re-query access key list; confirm target key absent",
            )
        return (
            "unsupported",
            f"signer unavailable ({reason})",
            "not revocable in this deployment",
        )
    if t == AuthorityType.CHILD_DELEGATION:
        return (
            "supported",
            "registry only",
            "confirm child authorities resolved first",
        )
    if t == AuthorityType.OBLIGATION:
        return (
            "partial",
            "depends on obligation provider",
            "inventory and report; cancellation not automatic",
        )
    if t == AuthorityType.SCHEDULED_JOB:
        return (
            "unsupported",
            "no cancellable provider configured",
            "manual cancellation required",
        )
    if t == AuthorityType.EXTERNAL_CREDENTIAL:
        return (
            "unsupported",
            "no revocation provider configured",
            "manual rotation required",
        )
    if t == AuthorityType.CONTRACT_ALLOWANCE:
        return (
            "unsupported",
            "no supported contract integration",
            "manual revocation required",
        )
    return ("unsupported", None, "manual review required")


def _post_order(authorities: list[AuthorityModel]) -> list[AuthorityModel]:
    """Depth-first post-order: children before parents.

    Deterministic by (type, resource, id) at each level.
    """
    by_id = {a.id: a for a in authorities}
    children: dict[str | None, list[AuthorityModel]] = {}
    for a in authorities:
        children.setdefault(a.parent_id, []).append(a)

    def _key(x: AuthorityModel) -> tuple[str, str, str]:
        return (x.type, x.resource, x.id)

    for lst in children.values():
        lst.sort(key=_key)

    ordered: list[AuthorityModel] = []
    visited: set[str] = set()

    def visit(node: AuthorityModel) -> None:
        if node.id in visited:
            return
        visited.add(node.id)
        for child in children.get(node.id, []):
            visit(child)
        ordered.append(node)

    # Roots first, then any unreachable cyclic components.
    for root in children.get(None, []):
        visit(root)
    for a in sorted(authorities, key=_key):
        if a.id not in visited:
            visit(a)

    return ordered


async def build_plan(
    agent: AgentModel, authorities: list[AuthorityModel]
) -> TerminationPlan:
    ordered = _post_order(authorities)
    steps: list[PlanStep] = []
    supported = unsupported = manual = 0

    for idx, a in enumerate(ordered, start=1):
        t = AuthorityType(a.type)
        support, auth_note, verification = _support_for_type(t)

        if support == "supported":
            supported += 1
            action = "revoke" if t == AuthorityType.NEAR_FUNCTION_KEY else "registry_revoke"
        elif support == "partial":
            manual += 1
            action = "manual"
        else:
            unsupported += 1
            action = "manual"

        depends_on = []
        if a.parent_id:
            parent = next((x for x in ordered if x.id == a.parent_id), None)
            if parent:
                depends_on.append(parent.id)

        steps.append(
            PlanStep(
                order=idx,
                authority_id=a.id,
                type=t,
                resource=a.resource,
                action=action,
                support=support,
                required_authorization=auth_note,
                depends_on=depends_on,
                risk="deleting a key may strand a running agent" if action == "revoke" else None,
                verification=verification,
            )
        )

    notes = []
    if unsupported:
        notes.append(
            f"{unsupported} authorities are unsupported in this deployment "
            "and require manual action."
        )
    if manual:
        notes.append(
            f"{manual} authorities are partially supported and will be "
            "inventoried but not automatically resolved."
        )

    return TerminationPlan(
        agent_id=agent.id,
        near_account=agent.near_account,
        network=Environment(agent.environment),
        total_authorities=len(ordered),
        supported_count=supported,
        unsupported_count=unsupported,
        manual_count=manual,
        steps=steps,
        notes=notes,
    )


@router.get(
    "/agents/{agent_id}/termination-plan",
    response_model=TerminationPlan,
    tags=["termination"],
)
async def get_plan(
    agent: AgentModel = Depends(require_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> TerminationPlan:
    rows = (
        (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.agent_id == agent.id)
            )
        )
        .scalars()
        .all()
    )
    return await build_plan(agent, list(rows))


# ---------------------------------------------------------------------------
# Job creation (no destructive execution yet)
# ---------------------------------------------------------------------------

@router.post(
    "/agents/{agent_id}/terminate",
    response_model=TerminationJobRead,
    status_code=202,
    tags=["termination"],
)
async def terminate_agent(
    body: TerminationRequest,
    agent: AgentModel = Depends(require_agent_owner),
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> TerminationJobRead:
    if agent.status in ("clean", "failed"):
        raise ApiError(
            "agent_terminal",
            f"agent is already '{agent.status}'",
            status_code=409,
        )

    # Idempotency: if the same key was used for this agent, return the
    # existing job instead of creating a duplicate.
    if body.idempotency_key:
        existing = (
            await session.execute(
                select(TerminationJob).where(
                    TerminationJob.agent_id == agent.id,
                    TerminationJob.idempotency_key == body.idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return TerminationJobRead.model_validate(existing)

    job = TerminationJob(
        agent_id=agent.id,
        owner_id=owner.id,
        reason=body.reason,
        idempotency_key=body.idempotency_key,
        phase=JobPhase.VALIDATE.value,
        status=JobStatus.PENDING.value,
    )
    session.add(job)
    agent.status = "termination_requested"
    await audit.record(
        session,
        agent_id=agent.id,
        actor_owner_id=owner.id,
        action="termination_requested",
        target_type="termination_job",
        payload={"reason": body.reason, "idempotency_key": body.idempotency_key},
    )
    await session.commit()
    await session.refresh(job)
    return TerminationJobRead.model_validate(job)


@router.get(
    "/terminations/{job_id}",
    response_model=TerminationJobRead,
    tags=["termination"],
)
async def get_job(
    job_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> TerminationJobRead:
    job = (
        await session.execute(
            select(TerminationJob).where(TerminationJob.id == job_id)
        )
    ).scalar_one_or_none()
    if job is None or job.owner_id != owner.id:
        raise ApiError("not_found", "Job not found.", status_code=404)
    return TerminationJobRead.model_validate(job)


@router.get(
    "/agents/{agent_id}/terminations",
    response_model=list[TerminationJobRead],
    tags=["termination"],
)
async def list_jobs(
    agent: AgentModel = Depends(require_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> list[TerminationJobRead]:
    rows = (
        (
            await session.execute(
                select(TerminationJob)
                .where(TerminationJob.agent_id == agent.id)
                .order_by(TerminationJob.requested_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [TerminationJobRead.model_validate(r) for r in rows]


@router.post(
    "/terminations/{job_id}/retry",
    response_model=TerminationJobRead,
    status_code=202,
    tags=["termination"],
)
async def retry_job(
    job_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> TerminationJobRead:
    """Retry a failed or partial job.

    - Resets retry_count, clears lock, schedules immediate pending state.
    - Preserves existing attempt rows — phase_revoke resumes from them,
      skipping terminal statuses and retrying failed ones.
    """
    job = (
        await session.execute(
            select(TerminationJob).where(TerminationJob.id == job_id)
        )
    ).scalar_one_or_none()
    if job is None or job.owner_id != owner.id:
        raise ApiError("not_found", "Job not found.", status_code=404)

    if job.status not in (JobStatus.FAILED.value, JobStatus.PARTIAL.value):
        raise ApiError(
            "not_retryable",
            f"job is '{job.status}', only failed or partial jobs can be retried",
            status_code=409,
        )

    if job.locked_by is not None:
        raise ApiError(
            "locked",
            "job is currently being processed",
            status_code=409,
        )

    job.status = JobStatus.PENDING.value
    job.retry_count = 0
    job.next_attempt_at = None
    job.completed_at = None
    job.error = None
    # Note: phase is left where it stopped. The worker resumes from there.

    await audit.record(
        session,
        agent_id=job.agent_id,
        actor_owner_id=owner.id,
        action="job_retried",
        target_type="termination_job",
        target_id=job.id,
        payload={"previous_status": "failed_or_partial"},
    )

    await session.commit()
    await session.refresh(job)
    return TerminationJobRead.model_validate(job)


# ---------------------------------------------------------------------------
# Phase engine — called by jobs.py worker
# ---------------------------------------------------------------------------

PHASE_ORDER = [
    JobPhase.VALIDATE,
    JobPhase.INVENTORY,
    JobPhase.PLAN,
    JobPhase.REVOKE,
    JobPhase.RESOLVE_OBLIGATIONS,
    JobPhase.VERIFY,
    JobPhase.FINALIZE,
    JobPhase.COMPLETE,
]


class PhaseAbort(Exception):
    """Terminal failure for a job — stop, mark failed."""


async def _set_phase(
    session: AsyncSession,
    job: TerminationJob,
    phase: JobPhase,
    status: JobStatus | None = None,
) -> None:
    job.phase = phase.value
    if status is not None:
        job.status = status.value
    await session.flush()


async def phase_validate(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    if agent.status in ("clean", "failed"):
        raise PhaseAbort(f"agent is already '{agent.status}'")
    agent.status = "terminating"
    await _set_phase(session, job, JobPhase.INVENTORY, JobStatus.RUNNING)


async def phase_inventory(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    rows = (
        (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.agent_id == agent.id)
            )
        )
        .scalars()
        .all()
    )
    job.plan = {
        "inventory": [
            {"id": a.id, "type": a.type, "resource": a.resource, "state": a.state}
            for a in rows
        ]
    }
    await _set_phase(session, job, JobPhase.PLAN)


async def phase_plan(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    rows = (
        (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.agent_id == agent.id)
            )
        )
        .scalars()
        .all()
    )
    plan = await build_plan(agent, list(rows))
    if job.plan is None:
        job.plan = {}
    job.plan["steps"] = [s.model_dump(mode="json") for s in plan.steps]
    await _set_phase(session, job, JobPhase.REVOKE)


async def phase_revoke(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    if not job.plan or "steps" not in job.plan:
        raise PhaseAbort("no plan available at revoke phase")

    try:
        signer = require_signer()
    except Exception as e:
        raise PhaseAbort(f"signer unavailable: {e}") from e

    rpc = get_rpc()

    existing = (
        (
            await session.execute(
                select(TerminationAttempt).where(TerminationAttempt.job_id == job.id)
            )
        )
        .scalars()
        .all()
    )
    by_authority = {a.authority_id: a for a in existing if a.authority_id}

    for step in job.plan["steps"]:
        if step["action"] not in ("revoke", "registry_revoke"):
            continue

        aid = step["authority_id"]
        attempt = by_authority.get(aid)

        if attempt and attempt.status in (
            "revoked",
            "already_absent",
            "unsupported",
            "skipped",
        ):
            continue

        if attempt is None:
            attempt = TerminationAttempt(
                job_id=job.id,
                authority_id=aid,
                action=step["action"],
                status="in_progress",
            )
            session.add(attempt)
            await session.flush()

        authority = (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.id == aid)
            )
        ).scalar_one_or_none()
        if authority is None:
            attempt.status = "skipped"
            attempt.error = {"code": "authority_missing"}
            await session.flush()
            continue

        if step["action"] == "registry_revoke":
            attempt.status = "skipped"
            attempt.error = {
                "code": "not_implemented",
                "message": "child delegation registry-only",
            }
            await session.flush()
            continue

        try:
            report = await execute_revoke_authority(
                authority=authority,
                agent=agent,
                signer=signer,
                rpc=rpc,
                session=session,
            )
            attempt.status = report.outcome.value
            attempt.tx_hash = report.tx_hash
            if report.outcome in (
                RevokeOutcome.REQUIRES_MANUAL_ACTION,
                RevokeOutcome.SUBMITTED_BUT_FAILED,
            ):
                attempt.error = {
                    "code": report.outcome.value,
                    "message": report.detail,
                }
        except ApiError as e:
            attempt.status = "failed"
            attempt.error = {"code": e.code, "message": e.message}
        await session.flush()

    # Audit summary of what just happened in the revoke phase.
    # Re-query to capture attempts created during this run, plus any
    # carried over from a prior attempt of the same job.
    final_attempts = (
        (
            await session.execute(
                select(TerminationAttempt).where(TerminationAttempt.job_id == job.id)
            )
        )
        .scalars()
        .all()
    )
    attempt_summary: dict[str, int] = {}
    for a in final_attempts:
        attempt_summary[a.status] = attempt_summary.get(a.status, 0) + 1
    await audit.record(
        session,
        agent_id=agent.id,
        actor_owner_id=job.owner_id,
        action="revocations_completed",
        target_type="termination_job",
        target_id=job.id,
        payload={"attempts_by_status": attempt_summary},
    )

    await _set_phase(session, job, JobPhase.RESOLVE_OBLIGATIONS)

async def phase_resolve_obligations(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    if job.plan is None:
        job.plan = {}

    manual = []
    for step in job.plan.get("steps", []):
        if step["action"] == "manual":
            manual.append(
                {
                    "authority_id": step["authority_id"],
                    "type": step["type"],
                    "resource": step["resource"],
                    "reason": step["verification"],
                }
            )
    job.plan["manual_items"] = manual
    await _set_phase(session, job, JobPhase.VERIFY)


async def phase_verify(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    await _set_phase(session, job, JobPhase.FINALIZE)


def _classify_result(
    attempts: list[TerminationAttempt], manual_items: list[dict]
) -> ReceiptResult:
    failed = any(
        a.status in ("failed", "requires_manual_action", "submitted_but_failed")
        for a in attempts
    )
    if failed:
        return ReceiptResult.PARTIAL
    if manual_items:
        return ReceiptResult.PARTIAL
    return ReceiptResult.CLEAN


async def phase_finalize(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    attempts = (
        (
            await session.execute(
                select(TerminationAttempt).where(TerminationAttempt.job_id == job.id)
            )
        )
        .scalars()
        .all()
    )
    result = _classify_result(
        list(attempts), (job.plan or {}).get("manual_items", [])
    )

    receipt = create_receipt(job, agent, list(attempts), result)
    session.add(receipt)
    await session.flush()

    job.receipt_id = receipt.id
    agent.status = result.value
    job.status = {
        ReceiptResult.CLEAN: JobStatus.SUCCEEDED.value,
        ReceiptResult.PARTIAL: JobStatus.PARTIAL.value,
        ReceiptResult.FAILED: JobStatus.FAILED.value,
    }[result]
    await _set_phase(session, job, JobPhase.COMPLETE)

    await audit.record(
        session,
        agent_id=agent.id,
        actor_owner_id=job.owner_id,
        action="receipt_created",
        target_type="receipt",
        target_id=receipt.id,
        payload={"result": result.value},
    )


async def phase_complete(
    session: AsyncSession, job: TerminationJob, agent: AgentModel
) -> None:
    job.completed_at = datetime.now(timezone.utc)
    await session.flush()

    await audit.record(
        session,
        agent_id=agent.id,
        actor_owner_id=job.owner_id,
        action="job_completed",
        target_type="termination_job",
        target_id=job.id,
        payload={
            "result": agent.status,
            "receipt_id": job.receipt_id,
        },
    )


PHASE_HANDLERS = {
    JobPhase.VALIDATE: phase_validate,
    JobPhase.INVENTORY: phase_inventory,
    JobPhase.PLAN: phase_plan,
    JobPhase.REVOKE: phase_revoke,
    JobPhase.RESOLVE_OBLIGATIONS: phase_resolve_obligations,
    JobPhase.VERIFY: phase_verify,
    JobPhase.FINALIZE: phase_finalize,
    JobPhase.COMPLETE: phase_complete,
}