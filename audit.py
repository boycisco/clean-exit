from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models import AuditEvent


async def record(
    session: AsyncSession,
    *,
    agent_id: str | None,
    actor_owner_id: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append an audit event. Never updates, never deletes."""
    event = AuditEvent(
        agent_id=agent_id,
        actor_owner_id=actor_owner_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        payload=payload or {},
    )
    session.add(event)
    await session.flush()
    return event