from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_agent_owner, require_owner
from database import get_session
from errors import ApiError
from models import Agent as AgentModel
from models import Authority as AuthorityModel
from models import Owner
from schemas import (
    AuthorityCreate,
    AuthorityGraph,
    AuthorityNode,
    AuthorityRead,
    AuthorityUpdate,
)


router = APIRouter(tags=["authorities"])


# ---------------------------------------------------------------------------
# Graph construction (unchanged behaviour from Step 3)
# ---------------------------------------------------------------------------

def _read(a: AuthorityModel) -> AuthorityRead:
    return AuthorityRead.model_validate(a)


def build_graph(agent_id: str, authorities: list[AuthorityModel]) -> AuthorityGraph:
    """Construct a deterministic tree from a flat authority list.

    Orphaned authorities (parent_id points at a missing row) appear
    only in the orphaned list, never as roots.
    """
    by_id = {a.id: a for a in authorities}

    children: dict[str | None, list[AuthorityModel]] = {}
    orphaned: list[AuthorityRead] = []
    orphaned_ids: set[str] = set()

    for a in authorities:
        if a.parent_id is not None and a.parent_id not in by_id:
            orphaned.append(_read(a))
            orphaned_ids.add(a.id)
            continue
        children.setdefault(a.parent_id, []).append(a)

    def _sort_key(x: AuthorityModel) -> tuple[str, str, str]:
        return (x.type, x.resource, x.id)

    for lst in children.values():
        lst.sort(key=_sort_key)
    orphaned.sort(key=lambda r: (r.type, r.resource, r.id))

    visited: set[str] = set()

    def walk(node: AuthorityModel) -> AuthorityNode:
        if node.id in visited:
            return AuthorityNode(authority=_read(node), children=[])
        visited.add(node.id)
        kids = [walk(c) for c in children.get(node.id, [])]
        return AuthorityNode(authority=_read(node), children=kids)

    roots = [walk(a) for a in children.get(None, [])]

    # Promote only unvisited, non-orphaned nodes — those are the heads
    # of pure-cyclic components with no path to a None root.
    for a in sorted(authorities, key=_sort_key):
        if a.id not in visited and a.id not in orphaned_ids:
            roots.append(walk(a))

    return AuthorityGraph(agent_id=agent_id, roots=roots, orphaned=orphaned)


# ---------------------------------------------------------------------------
# Cycle detection
# ---------------------------------------------------------------------------

async def _ancestor_chain(session: AsyncSession, start_id: str) -> list[str]:
    """Return [start_id, parent(start_id), grandparent(...), ...].

    Stops on missing rows or if a cycle is detected in existing data
    (defensive — the API prevents creating cycles, but hand-edited rows
    or future features might not).
    """
    chain: list[str] = []
    seen: set[str] = set()
    current: str | None = start_id
    while current is not None:
        if current in seen:
            break
        seen.add(current)
        chain.append(current)
        current = (
            await session.execute(
                select(AuthorityModel.parent_id).where(AuthorityModel.id == current)
            )
        ).scalar_one_or_none()
    return chain


async def would_create_cycle(
    session: AsyncSession,
    authority_id: str | None,
    parent_id: str | None,
) -> bool:
    """True if setting parent_id as the parent would create a cycle.

    authority_id=None means "we are creating a new authority" (which can
    only cycle if the existing parent chain is already corrupt).
    """
    if parent_id is None:
        return False
    if authority_id is not None and parent_id == authority_id:
        return True

    chain = await _ancestor_chain(session, parent_id)
    if authority_id is not None and authority_id in chain:
        return True
    if len(chain) != len(set(chain)):  # never true given _ancestor_chain's guard
        return True
    return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/agents/{agent_id}/authorities",
    response_model=AuthorityRead,
    status_code=201,
)
async def create_authority(
    body: AuthorityCreate,
    agent: AgentModel = Depends(require_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> AuthorityRead:
    if body.parent_id is not None:
        parent = (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.id == body.parent_id)
            )
        ).scalar_one_or_none()
        if parent is None or parent.agent_id != agent.id:
            raise ApiError(
                "invalid_parent",
                "Parent authority not found on this agent.",
                status_code=400,
            )

    if await would_create_cycle(session, None, body.parent_id):
        raise ApiError(
            "cycle_detected",
            "Parent chain already contains a cycle.",
            status_code=409,
        )

    authority = AuthorityModel(
        agent_id=agent.id,
        parent_id=body.parent_id,
        type=body.type.value,
        provider=body.provider,
        resource=body.resource,
        scope=body.scope,
        revocable=body.revocable,
        source=body.source.value,
        meta=body.meta,
        # state defaults to "unverified" via the model — the honest default.
        # A registered authority is *claimed* to exist; we haven't confirmed it.
    )
    session.add(authority)
    await session.commit()
    await session.refresh(authority)
    return AuthorityRead.model_validate(authority)


@router.get("/authorities/{authority_id}", response_model=AuthorityRead)
async def get_authority(
    authority_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> AuthorityRead:
    row = (
        await session.execute(
            select(AuthorityModel).where(AuthorityModel.id == authority_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("not_found", "Authority not found.", status_code=404)

    owner_id = (
        await session.execute(
            select(AgentModel.owner_id).where(AgentModel.id == row.agent_id)
        )
    ).scalar_one_or_none()
    if owner_id != owner.id:
        # 404 for cross-owner, same as agents.py — never leak existence.
        raise ApiError("not_found", "Authority not found.", status_code=404)

    return AuthorityRead.model_validate(row)


@router.patch("/authorities/{authority_id}", response_model=AuthorityRead)
async def update_authority(
    body: AuthorityUpdate,
    authority_id: str,
    owner: Owner = Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> AuthorityRead:
    row = (
        await session.execute(
            select(AuthorityModel).where(AuthorityModel.id == authority_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ApiError("not_found", "Authority not found.", status_code=404)

    owner_id = (
        await session.execute(
            select(AgentModel.owner_id).where(AgentModel.id == row.agent_id)
        )
    ).scalar_one_or_none()
    if owner_id != owner.id:
        raise ApiError("not_found", "Authority not found.", status_code=404)

    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return AuthorityRead.model_validate(row)


@router.get("/agents/{agent_id}/authorities", response_model=AuthorityGraph)
async def agent_authorities(
    agent: AgentModel = Depends(require_agent_owner),
    session: AsyncSession = Depends(get_session),
) -> AuthorityGraph:
    rows = (
        (
            await session.execute(
                select(AuthorityModel).where(AuthorityModel.agent_id == agent.id)
            )
        )
        .scalars()
        .all()
    )
    return build_graph(agent.id, list(rows))