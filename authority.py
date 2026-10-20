from __future__ import annotations

from models import Authority as AuthorityModel
from schemas import AuthorityGraph, AuthorityNode, AuthorityRead


def _read(a: AuthorityModel) -> AuthorityRead:
    return AuthorityRead.model_validate(a)


def build_graph(
    agent_id: str,
    authorities: list[AuthorityModel],
) -> AuthorityGraph:
    """Construct a deterministic tree from a flat authority list.

    Guarantees:
      - Roots appear in stable order (by type, resource, id).
      - Children appear in stable order.
      - Nodes with parent_id pointing outside this agent become orphans.
      - Cycles never cause infinite recursion; a node is walked at most once.
      - Any node unreachable from a natural root (because of a cycle) is
        promoted to its own root so nothing is silently dropped.
    """
    by_id = {a.id: a for a in authorities}

    children: dict[str | None, list[AuthorityModel]] = {}
    orphaned: list[AuthorityRead] = []

    for a in authorities:
        if a.parent_id is not None and a.parent_id not in by_id:
            orphaned.append(_read(a))
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
            # Cycle back-edge: return a leaf view to break recursion.
            return AuthorityNode(authority=_read(node), children=[])
        visited.add(node.id)
        kids = [walk(c) for c in children.get(node.id, [])]
        return AuthorityNode(authority=_read(node), children=kids)

    roots = [walk(a) for a in children.get(None, [])]

    # Promote any still-unvisited nodes (cyclic components) to roots.
    for a in sorted(authorities, key=_sort_key):
        if a.id not in visited:
            roots.append(walk(a))

    return AuthorityGraph(agent_id=agent_id, roots=roots, orphaned=orphaned)