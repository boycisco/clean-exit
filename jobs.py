from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import get_session_factory
from models import Agent as AgentModel
from models import TerminationJob
from schemas import JobPhase, JobStatus
from termination import (
    PERMANENT_CODES,
    PHASE_HANDLERS,
    TRANSIENT_CODES,
    PhaseAbort,
)


log = logging.getLogger("clean.jobs")


def _classify(err_code: str | None) -> str:
    if err_code in TRANSIENT_CODES:
        return "transient"
    if err_code in PERMANENT_CODES:
        return "permanent"
    return "unknown"


async def claim_next_job(
    session: AsyncSession, worker_id: str
) -> TerminationJob | None:
    """Atomically claim one pending job."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(TerminationJob)
        .where(
            TerminationJob.status == JobStatus.PENDING.value,
            TerminationJob.retry_count < get_settings().worker_max_retries,
        )
        .order_by(TerminationJob.requested_at.asc())
        .limit(1)
    )
    job = (await session.execute(stmt)).scalar_one_or_none()
    if job is None:
        return None

    if job.next_attempt_at and job.next_attempt_at > now:
        return None

    result = await session.execute(
        update(TerminationJob)
        .where(
            TerminationJob.id == job.id,
            TerminationJob.locked_by.is_(None),
        )
        .values(locked_by=worker_id, locked_at=now, status=JobStatus.RUNNING.value)
    )
    await session.commit()
    if result.rowcount == 0:
        return None

    await session.refresh(job)
    return job


async def recover_stale_jobs(session: AsyncSession) -> int:
    """Reset jobs whose worker died."""
    settings = get_settings()
    cutoff = datetime.now(timezone.utc) - timedelta(
        seconds=settings.worker_stale_seconds
    )
    result = await session.execute(
        update(TerminationJob)
        .where(
            TerminationJob.status == JobStatus.RUNNING.value,
            TerminationJob.locked_at.isnot(None),
            TerminationJob.locked_at < cutoff,
        )
        .values(status=JobStatus.PENDING.value, locked_by=None, locked_at=None)
    )
    await session.commit()
    if result.rowcount:
        log.warning("Recovered %d stale jobs", result.rowcount)
    return result.rowcount


async def run_job(session: AsyncSession, job: TerminationJob) -> None:
    """Drive one job through the phase handlers."""
    agent = (
        await session.execute(
            select(AgentModel).where(AgentModel.id == job.agent_id)
        )
    ).scalar_one_or_none()
    if agent is None:
        job.status = JobStatus.FAILED.value
        job.error = {"code": "agent_missing"}
        await session.commit()
        return

    try:
        phase = JobPhase(job.phase)
        ordered_all = list(PHASE_HANDLERS.keys())
        start_idx = ordered_all.index(phase)
        ordered = ordered_all[start_idx:]

        for phase_enum in ordered:
            handler = PHASE_HANDLERS[phase_enum]
            await handler(session, job, agent)
            await session.commit()

        if job.status == JobStatus.SUCCEEDED.value and job.completed_at is None:
            job.completed_at = datetime.now(timezone.utc)
            await session.commit()

    except PhaseAbort as e:
        job.status = JobStatus.FAILED.value
        job.error = {"code": "phase_abort", "message": str(e)}
        job.completed_at = datetime.now(timezone.utc)
        await session.commit()
        log.error("Job %s aborted: %s", job.id, e)

    except Exception as e:
        log.exception("Job %s crashed", job.id)
        settings = get_settings()
        backoff_seconds = min(60 * (2 ** job.retry_count), 3600)
        job.retry_count += 1
        job.locked_by = None
        job.locked_at = None
        if job.retry_count >= settings.worker_max_retries:
            job.status = JobStatus.FAILED.value
            job.error = {"code": "max_retries", "message": str(e)[:500]}
            job.completed_at = datetime.now(timezone.utc)
        else:
            job.status = JobStatus.PENDING.value
            job.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                seconds=backoff_seconds
            )
            job.error = {"code": "transient", "message": str(e)[:500]}
        await session.commit()


async def worker_loop(worker_id: str, stop_event: asyncio.Event) -> None:
    """Infinite worker loop. Sleeps between iterations."""
    settings = get_settings()
    session_factory = get_session_factory()

    while not stop_event.is_set():
        try:
            async with session_factory() as session:
                await recover_stale_jobs(session)
                job = await claim_next_job(session, worker_id)
                if job is None:
                    await asyncio.sleep(settings.worker_poll_seconds)
                    continue
                log.info("Claimed job %s", job.id)
                await run_job(session, job)
        except Exception:
            log.exception("Worker loop iteration failed")
            await asyncio.sleep(settings.worker_poll_seconds)