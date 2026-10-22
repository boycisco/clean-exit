from __future__ import annotations

from datetime import datetime, timezone

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
)


router = APIRouter(tags=["termination"])


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