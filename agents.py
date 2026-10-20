from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_agent_owner, require_owner
from database import get_session
from models import Agent as AgentModel
from models import Owner
from schemas import (
    AgentCreate,
    AgentRead,
    AgentStatus,
    AgentUpdate,
)


router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("", response_model=AgentRead, status_code=201)
async def create_agent(
    body: AgentCreate,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> AgentRead:
    agent = AgentModel(
        owner_id=owner.id,
        name=body.name,
        near_account=body.near_account,
        environment=body.environment.value,
        description=body.description,
        meta=body.meta,
        status=AgentStatus.ACTIVE.value,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return AgentRead.model_validate(agent)


@router.get("", response_model=list[AgentRead])
async def list_agents(
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
    status_filter: AgentStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AgentRead]:
    stmt = select(AgentModel).where(AgentModel.owner_id == owner.id)
    if status_filter is not None:
        stmt = stmt.where(AgentModel.status == status_filter.value)
    stmt = stmt.order_by(desc(AgentModel.created_at)).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).scalars().all()
    return [AgentRead.model_validate(r) for r in rows]


@router.get("/{agent_id}", response_model=AgentRead)
async def get_agent(agent: AgentModel = Depends(require_agent_owner)) -> AgentRead:
    return AgentRead.model_validate(agent)


@router.patch("/{agent_id}", response_model=AgentRead)
async def update_agent(
    body: AgentUpdate,
    agent: AgentModel = Depends(require_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> AgentRead:
    data = body.model_dump(exclude_unset=True)
    if not data:
        return AgentRead.model_validate(agent)
    for key, value in data.items():
        setattr(agent, key, value)
    await session.commit()
    await session.refresh(agent)
    return AgentRead.model_validate(agent)