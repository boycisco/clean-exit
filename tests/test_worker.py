from __future__ import annotations

from datetime import datetime, timedelta, timezone

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