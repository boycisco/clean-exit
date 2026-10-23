# Clean Exit — API contract for frontend integration

**Version:** v1 (schema version 1)
**Status:** backend complete through Priority 3; Priority 4 (on-chain receipt publishing) is pending.

This document is the contract between the Clean Exit backend and any
frontend client. It describes every endpoint, every response shape,
every state machine, and — most importantly — what the API does **not**
claim to know.

---

## Table of contents

1. Base URL, versioning, and time formats
2. Authentication
3. Error envelope
4. Capabilities discovery — read this first
5. Agents
6. Authorities
7. Termination
8. Receipts
9. Audit
10. State machines (authoritative reference)
11. What the API does not claim
12. OpenAPI

---

## 1. Base URL, versioning, and time formats

All endpoints are under `/api/v1`. The version is also present as
`schema_version` inside every receipt payload. Semver of the API is not
currently exposed; the OpenAPI document carries the application version.

| Environment | Base URL |
| --- | --- |
| Local dev | `http://127.0.0.1:8000` |
| Testnet staging | *not yet deployed* |
| Production | *not yet deployed* |

All timestamps in responses are **ISO 8601 with a `Z` suffix** (UTC).
Example: `2026-10-23T14:32:11.456789Z`.

The API accepts JSON in request bodies with `Content-Type: application/json`.
Character encoding is always UTF-8.

---

## 2. Authentication

Every private endpoint requires a ******** in the
`Authorization` header:

`Authorization: ******`

text

The `ce_` prefix identifies Clean Exit tokens. Token strings are
generated server-side and stored as SHA-256 hashes. The raw token is
shown to the user **exactly once** at issue time; it can never be
retrieved again.

**The API will never accept a user-supplied owner ID as identity.**
There is no query parameter, body field, or header that grants
ownership. Ownership is derived exclusively from the token.

The following endpoints do **not** require authentication:

- `GET /health`
- `GET /api/v1/capabilities`
- `GET /openapi.json` (FastAPI-generated)

Every other endpoint requires a valid ****** Any endpoint that
accepts an `{agent_id}` path parameter enforces **agent-level ownership**
server-side: a valid token from a different owner receives **404 Not
Found**, not 403 Forbidden, to avoid leaking which IDs exist.

### Token lifecycle

Tokens do not currently expire. They can be revoked server-side (this
sets `revoked_at` on the owner record), after which every request with
that token returns **401 Unauthorized**. The frontend should surface
this as "session ended, please log in again."

---

## 3. Error envelope

Every non-2xx response has the same shape:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human-readable explanation.",
    "details": {},
    "request_id": "uuid-shape-string"
  }
}
```

- `code` is a stable string the frontend can pattern-match on.
  Never compare against message.
- `message` is human-readable and may change.
- `details` is usually an empty object. In some cases it contains
  validation errors (see below).
- `request_id` matches the `X-Request-ID` response header, for
  correlation with server logs.

### Common codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `unauthorized` | Missing / malformed / unknown / revoked token |
| 404 | `not_found` | Resource missing, or exists but belongs to another owner |
| 409 | `not_active` | Authority is not in the active state |
| 409 | `not_retryable` | Job status doesn't allow retry |
| 409 | `agent_terminal` | Agent is already clean or failed |
| 422 | `validation_error` | Body doesn't match schema |
| 422 | `unsupported_type` | Authority type can't be revoked |
| 429 | `rate_limited` | Too many requests (only on destructive endpoints) |
| 500 | `internal_error` | Unexpected server error |
| 502 | `rpc_unavailable` | NEAR RPC unreachable |
| 503 | `signer_unavailable` | No signer configured — destructive ops disabled |

### Validation error shape

`validation_error` responses carry `details.errors` as an array of
Pydantic v2 errors:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": {
      "errors": [
        {
          "type": "value_error",
          "loc": ["body", "near_account"],
          "msg": "Value error, invalid NEAR account ID",
          "input": "Alice.Testnet",
          "ctx": { "error": "invalid NEAR account ID" }
        }
      ]
    },
    "request_id": "..."
  }
}
```

Note: `ctx.error` is always a string, never a live exception object.

---

## 4. Capabilities discovery — read this first

Before showing or enabling any destructive UI, the frontend must
call GET /api/v1/capabilities and use its response to decide what to
enable. Never hardcode which buttons are active.

```http
GET /api/v1/capabilities
```

```json
{
  "network": "testnet",
  "signer_configured": false,
  "signer_reason": "signer_unavailable",
  "receipt_publisher_configured": false,
  "contract_configured": false,
  "rate_limit_enabled": false,
  "authority_types_registered": [
    "near_function_key",
    "scheduled_job",
    "external_credential",
    "obligation",
    "child_delegation"
  ],
  "authority_types_revocable": [],
  "authority_types_verifiable": ["near_function_key"]
}
```

### Field meanings

- `signer_configured` — whether the server has a signer key loaded
  and can submit transactions. If false, all destructive endpoints
  return `503`.
- `signer_reason` — one of "ok", "signer_unavailable",
  "signer_invalid", or "mainnet_signing_forbidden_in_non_production".
  The last two mean an operator must fix configuration before
  destructive operations can work.
- `receipt_publisher_configured` — whether the on-chain registry
  contract and publisher key are configured. If false,
  `POST /api/v1/receipts/{id}/publish` returns `503`. Verification
  of previously-published receipts still works (it just reads chain
  state).
- `contract_configured` — whether the registry contract ID is set.
  Independent of publisher key configuration.
- `authority_types_revocable` — subset of registered types that can
  be actually revoked on-chain by this deployment. Today:
  `near_function_key` only when `signer_configured=true`.
- `authority_types_verifiable` — subset that can be verified
  against chain state without signing. Today:
  `near_function_key`.

Frontend rule: if a UI element represents an operation, show it as
disabled (with a tooltip naming `signer_reason`) unless its requirement
is present.

---

## 5. Agents

An agent is the top-level entity. Owners register agents, attach
authorities, and (optionally) terminate them.

### POST /api/v1/agents

Register a new agent. Requires auth.

#### Request body

```json
{
  "name": "temporary-agent",
  "near_account": "alice.testnet",
  "environment": "testnet",
  "description": "Scratch agent for task #42",
  "meta": { "team": "ops" }
}
```

- `name` — 1–128 chars. Required.
- `near_account` — optional. If present, must be a valid NEAR account
  ID (2–64 chars, lowercase alphanumeric plus `-`, `_`, `.` separators;
  or a 64-char hex implicit account).
- `environment` — "testnet" (default) or "mainnet".
- `description` — optional, up to 4096 chars.
- `meta` — optional JSON object, serialized size ≤ 4096 bytes.

#### Response 201

```json
{
  "id": "uuid",
  "name": "temporary-agent",
  "near_account": "alice.testnet",
  "environment": "testnet",
  "description": "Scratch agent for task #42",
  "status": "active",
  "meta": { "team": "ops" },
  "created_at": "2026-10-23T14:32:11.456Z",
  "last_activity_at": "2026-10-23T14:32:11.456Z"
}
```

Note: status is always "active" for a newly created agent. It
is never "clean" by default. Spec §4A forbids this.

### GET /api/v1/agents

List agents belonging to the authenticated owner.

#### Query parameters

- `status` — optional filter, one of the lifecycle statuses.
- `limit` — 1–200, default 50.
- `offset` — ≥0, default 0.

#### Response 200

Array of `Agent` objects, ordered by `created_at` desc.

### GET /api/v1/agents/{agent_id}

Retrieve a single agent. 404 if not owned by the caller.

### PATCH /api/v1/agents/{agent_id}

Update permitted fields. Only name, description, and meta are
mutable. near_account and environment are immutable after
creation — changing them would invalidate verifications. To change
those, delete and re-register.

#### Request body

All fields optional; null clears a nullable field:

```json
{ "name": "renamed", "description": "new description" }
```

---

## 6. Authorities

An authority is a permission, credential, capability, or obligation
attached to an agent. Authorities form a directed graph via
parent_id.

### POST /api/v1/agents/{agent_id}/authorities

Register a known authority. Requires auth and agent ownership.

#### Request body

```json
{
  "type": "near_function_key",
  "provider": "near",
  "resource": "ed25519:9Rzugrms7J8HHEcCP6wndF6GVAYkbtySYZiKgpisq2LU",
  "parent_id": null,
  "scope": { "method": "transfer" },
  "revocable": true,
  "source": "registered",
  "meta": {}
}
```

- `type` — one of near_function_key, contract_allowance,
  scheduled_job, external_credential, obligation,
  child_delegation.
- `provider` — free-form, e.g. "near", "clean", "github".
- `resource` — the identifier for this authority. For NEAR keys, use
  the full ed25519:<base58> public key string.
- `parent_id` — optional; must reference an existing authority on the
  same agent. Attempting to set a `parent_id` that would create a
  cycle returns `400 invalid_parent`.
- `revocable` — whether the caller claims this authority is
  revocable. The backend verifies independently; this field is a hint.
- `source` — "registered" (default) or "discovered". Registered
  means "operator told us." Discovered means "we found it during
  scanning."
- `meta`, `scope` — JSON objects, each ≤4096 bytes serialized.

#### Response 201

Authority object. Note: `state` is always
"unverified" for a newly registered authority. Registering does
not constitute verification.

### GET /api/v1/authorities/{authority_id}

Fetch one authority. 404 if the authority doesn't exist or belongs to
a different owner's agent.

### PATCH /api/v1/authorities/{authority_id}

Update `scope`, `meta`, `revocable`. `parent_id` and `type` are not
mutable. Re-parenting requires deletion and re-registration — this
is deliberate (structure is versioned by audit log).

### GET /api/v1/agents/{agent_id}/authorities

Return the full authority graph for an agent.

#### Response 200

```json
{
  "agent_id": "uuid",
  "roots": [
    {
      "authority": { "id": "...", "type": "near_function_key", ... },
      "children": [
        { "authority": { "id": "...", "type": "child_delegation", ... }, "children": [] }
      ]
    }
  ],
  "orphaned": [
    {
      "id": "...",
      "parent_id": "missing-uuid",
      "...": "..."
    }
  ]
}
```

- `roots` — authorities with no parent, plus any cyclic components
  promoted to roots to avoid infinite recursion.
- `orphaned` — authorities whose `parent_id` points at a missing row.
  The frontend should display these with a warning icon.

Traversal is deterministic: same data always produces the same
tree shape and ordering.

### POST /api/v1/agents/{agent_id}/verify

Read-only reconciliation against real on-chain state. Requires auth
and ownership. Does not sign, does not submit transactions.

#### Response 200

```json
{
  "agent_id": "uuid",
  "near_account": "alice.testnet",
  "checked_at": "2026-10-23T14:32:11.456Z",
  "account_exists": true,
  "total_observed_keys": 2,
  "verified": [
    {
      "authority_id": "uuid",
      "type": "near_function_key",
      "resource": "ed25519:ABC",
      "previous_state": "unverified",
      "new_state": "active",
      "on_chain": true,
      "detail": "observed on chain"
    }
  ],
  "skipped": [
    {
      "authority_id": "uuid",
      "type": "obligation",
      "resource": "pending-1",
      "previous_state": "active",
      "new_state": "active",
      "on_chain": null,
      "detail": "verification not supported for type obligation"
    }
  ],
  "error": null
}
```

Critical: `on_chain` is tri-state. The frontend must never
render null as "not on chain."

- `true` — we queried chain and saw it
- `false` — we queried chain and did not see it
- `null` — we could not query (RPC failed, account absent, unsupported
type, etc.)

When `error` is non-null, the verification was inconclusive. The
frontend should display the error and not change any badges to
"expired" or "revoked."

The backend never marks an authority expired without a successful
key-list query — spec §6 forbids fabricated absence. If the RPC
fails, authorities remain unverified and appear in skipped.

---

## 7. Termination

Termination is a durable, asynchronous operation. A request
creates a job; a worker executes it in phases. The frontend polls for
status.

### GET /api/v1/agents/{agent_id}/termination-plan

Read-only. Returns what would happen if you terminate the agent.

#### Response 200

```json
{
  "agent_id": "uuid",
  "near_account": "alice.testnet",
  "network": "testnet",
  "total_authorities": 3,
  "supported_count": 2,
  "unsupported_count": 1,
  "manual_count": 0,
  "steps": [
    {
      "order": 1,
      "authority_id": "uuid",
      "type": "child_delegation",
      "resource": "child-1",
      "action": "registry_revoke",
      "support": "supported",
      "required_authorization": "registry only",
      "depends_on": ["uuid-parent"],
      "risk": null,
      "verification": "confirm child authorities resolved first"
    }
  ],
  "notes": [
    "1 authorities are unsupported in this deployment and require manual action."
  ]
}
```

Ordering: steps are emitted in post-order — children before
parents. Terminating in this order is safe; reverse order would revoke
a parent before its children and leave dangling delegations.

`action` values:

- `revoke` — will submit a real revocation (NEAR key deletion)
- `registry_revoke` — will update internal registry only, no chain tx
- `verify` — will re-query chain state
- `manual` — cannot be automated; the frontend should show it as a
  to-do item for the operator
- `skip` — out of scope for this termination

`support` values:

- `supported` — will be handled automatically
- `partial` — inventoried and reported, but not fully resolved
- `unsupported` — will be marked as manual

### POST /api/v1/agents/{agent_id}/terminate

Create a termination job. Requires auth and ownership.

#### Request body

```json
{
  "reason": "task completed",
  "idempotency_key": "client-uuid-here"
}
```

- `reason` — optional, ≤2048 chars.
- `idempotency_key` — optional, 1–128 chars. Strongly recommended.
  Two requests with the same key for the same agent return the same
  job. Clients should generate a UUID per intentional "terminate" click
  and reuse it on network retries.

#### Response 202

```json
{
  "id": "job-uuid",
  "agent_id": "uuid",
  "reason": "task completed",
  "phase": "validate",
  "status": "pending",
  "retry_count": 0,
  "error": null,
  "receipt_id": null,
  "requested_at": "2026-10-23T14:32:11.456Z",
  "started_at": null,
  "completed_at": null
}
```

Important: a 202 response means the job was created, not that
the termination succeeded. The frontend must poll GET /terminations/{job_id}
for status. Do not show "terminated" on a 202 response.

### GET /api/v1/terminations/{job_id}

Poll status. 404 if not the caller's job.

#### Response 200

Same shape as the 202 body above, with updated
phase, status, receipt_id as phases progress.

See the state machine in section 10.

### GET /api/v1/agents/{agent_id}/terminations

List jobs for an agent, ordered newest first.

### POST /api/v1/terminations/{job_id}/retry

Retry a failed or partial job.

- Resets `retry_count` to 0.
- Clears `error`, `completed_at`, and `locked_by`.
- Preserves existing attempts — the worker resumes from where the
  last run stopped, skipping terminal-status attempts and retrying
  failed ones.
- Guards: returns `409 not_retryable` if job status is neither
  `failed` nor `partial`. Returns `409 locked` if a worker currently
  holds the job.

Never retries irreversible actions blindly — the worker inspects
TerminationAttempt rows before re-executing. A revoked attempt
means the key is already gone; the worker will not send another
transaction for it.

---

## 8. Receipts

Receipts are created by the termination worker at the finalize phase.
They are immutable — once created, they can never be modified.
Subsequent corrections happen as superseding verification records,
not edits.

### GET /api/v1/receipts/{receipt_id}

Status: not yet implemented (Priority 4c). Returns 404 today.

#### Planned response

```json
{
  "id": "receipt-uuid",
  "agent_id": "agent-uuid",
  "agent_near_account": "alice.testnet",
  "network": "testnet",
  "result": "clean",
  "schema_version": 1,
  "payload": { "…canonical payload…" },
  "payload_hash": "sha256-hex-64-chars",
  "onchain_tx_hash": "…or null if not yet published…",
  "verification_status": "not_published",
  "requested_at": "2026-10-23T14:30:00.000Z",
  "completed_at": "2026-10-23T14:32:11.456Z",
  "published_at": null
}
```

`verification_status` values:

- `not_published` — receipt exists off-chain; no on-chain commitment
- `pending` — a publish transaction has been submitted but not confirmed
- `published` — on-chain commitment confirmed
- `verification_failed` — an attempted publication or verification
  failed

### GET /api/v1/receipts/{receipt_id}/verify

Status: not yet implemented (Priority 4c). Returns 404 today.

#### Planned response

```json
{
  "receipt_id": "receipt-uuid",
  "payload_hash": "…stored hash…",
  "recomputed_hash": "…recomputed from payload…",
  "hash_matches": true,
  "onchain_status": "published",
  "onchain_tx_hash": "…",
  "onchain_hash": "…hash stored on chain…",
  "onchain_matches": true,
  "verified": true,
  "notes": []
}
```

Critical: `verified: true` means the payload is intact and the
on-chain commitment matches — it does not mean every authority in the
scope was successfully revoked. Read payload.result for that. An
on-chain tx hash alone is not proof of correctness; it's proof the
commitment was recorded.

### GET /api/v1/agents/{agent_id}/receipt

Status: not yet implemented (Priority 4c).

Returns the latest finalized receipt for the agent, if any. 404 if
no receipt exists yet.

---

## 9. Audit

### GET /api/v1/agents/{agent_id}/audit

Paginated, chronological (oldest first) event trail for an agent.

Query params: limit (1–200, default 50), offset (≥0, default 0).

#### Response 200

```json
[
  {
    "id": 42,
    "agent_id": "agent-uuid",
    "actor_owner_id": "owner-uuid-or-null",
    "action": "termination_requested",
    "target_type": "termination_job",
    "target_id": "job-uuid",
    "payload": { "reason": "done", "idempotency_key": "k1" },
    "created_at": "2026-10-23T14:30:00.000Z"
  }
]
```

#### Known action values

- `termination_requested` — a job was created
- `job_retried` — a failed/partial job was re-queued
- `revocations_completed` — the revoke phase finished (payload has
  attempts_by_status counts)
- `receipt_created` — a receipt row was written
- `job_completed` — the job reached a terminal phase

Audit events are append-only at the application level. There is
no endpoint to delete or modify events.

---

## 10. State machines (authoritative reference)

### Agent status

| Status | Meaning | Terminal? |
| --- | --- | --- |
| active | Default. Agent is running normally. | No |
| termination_requested | A job has been created, not yet executing. | No |
| terminating | Worker is actively processing a termination job. | No |
| clean | Every authority in scope was revoked or verified absent, no unresolved obligations. | Yes |
| partial | At least one authority is unresolved, unsupported, or failed. | Yes |
| failed | Termination could not establish a trustworthy outcome. | Yes |

A clean status is a scoped claim, not universal proof. See §11.

### Authority state

| State | Meaning |
| --- | --- |
| active | Verified present on chain, or newly registered with confidence. |
| revocation_pending | A revocation has been submitted but not confirmed. |
| revoked | Confirmed absent after a successful revocation transaction. |
| expired | Verified absent — either never existed, or was already gone before we tried. |
| unverified | Registered but not yet verified against chain. |
| unsupported | The type cannot be verified or revoked by this deployment. |
| failed | A revocation was attempted and did not succeed. |
| requires_manual_action | A transaction succeeded but the post-check couldn't confirm; operator must investigate. |

`revoked` and `expired` are distinct. `revoked` implies we
submitted a deletion that confirmed. `expired` means "gone, but not
by our hand." Frontends should distinguish these in the UI.

### Job phase

Phases always proceed in this order and never go backwards:

```text
text
validate → inventory → plan → revoke → resolve_obligations
         → verify → finalize → complete
```

### Job status

| Status | Meaning |
| --- | --- |
| pending | Created; not yet claimed by a worker |
| running | A worker has claimed it and is executing phases |
| succeeded | Ran to completion; receipt created |
| partial | Ran to completion; some authorities unresolved |
| failed | Aborted, exhausted retries, or crashed |
| cancelled | (Not yet used; reserved) |

Note: `succeeded` vs `partial` is not the same as receipt
`clean` vs `partial`. A job can succeed (worker completed all phases)
while the receipt is partial (some authorities couldn't be handled).
Frontends should display receipt result, not job status, as the
user-facing outcome.

### Receipt result

| Result | Meaning |
| --- | --- |
| clean | All authorities in scope resolved |
| partial | Some authorities unresolved, unsupported, or failed |
| failed | Outcome could not be established |

---

## 11. What the API does not claim

The spec is explicit that Clean Exit must never overclaim. Frontend
developers must not infer more than the API states:

- `clean` is scoped. It means: "every authority registered in
  this Clean Exit instance for this agent has been revoked or verified
  absent." It does not mean: "the agent has no rights anywhere."
  There may be permissions, keys, and allowances we never knew about.
- `verified: true` on a receipt means the payload hash matches
  the on-chain commitment. It does not mean every revocation claim
  in the payload was independently corroborated by NEAR. Read the
  per-attempt outcomes.
- `on_chain: null` in verification results is not false.
  Never display "not on chain" when the field is null — it means
  "we couldn't check."
- A `202` on `/terminate` is a job creation, not a result. Poll.
- `signer_configured: false` means no destructive operation can
  succeed. Do not show "revoke" as available.
- `receipt_publisher_configured: false` means on-chain publishing
  is disabled. Do not display a tx hash. The receipt exists in the
  DB with `verification_status: "not_published"`.
- Neither `signer_configured: true` nor `revoked` outcome means
  the world has been cleaned. Only authorities in this registry
  are known to be revoked. Deleting a function-call key does not
  cancel a submitted transaction or undo completed actions.
- The system does not enumerate authorities automatically.
  Operators must register authorities. Discovery is a future feature.
  An empty authority list means "the operator has registered nothing,"
  not "the agent has no authorities."

---

## 12. OpenAPI

The FastAPI-generated interactive documentation is available at:

- `/docs` — Swagger UI, human-friendly, can be used to make requests
  against a live server
- `/redoc` — ReDoc, more formal schema view
- `/openapi.json` — the raw OpenAPI 3.0 schema

The Python SDK at `sdk/client.py` is generated from the same
endpoints. Treat any inconsistency between this document and the
OpenAPI schema as a bug in this document — the OpenAPI schema is
authoritative.

## Appendix A — Full endpoint list

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | — | Health check |
| GET | `/api/v1/capabilities` | — | Discover enabled capabilities |
| POST | `/api/v1/agents` | ✓ | Create agent |
| GET | `/api/v1/agents` | ✓ | List agents |
| GET | `/api/v1/agents/{id}` | ✓ | Get agent |
| PATCH | `/api/v1/agents/{id}` | ✓ | Update agent |
| POST | `/api/v1/agents/{id}/authorities` | ✓ | Register authority |
| GET | `/api/v1/agents/{id}/authorities` | ✓ | Authority graph |
| POST | `/api/v1/agents/{id}/verify` | ✓ | Verify on chain |
| GET | `/api/v1/agents/{id}/termination-plan` | ✓ | Plan termination |
| POST | `/api/v1/agents/{id}/terminate` | ✓ | Create job |
| GET | `/api/v1/agents/{id}/terminations` | ✓ | List jobs |
| GET | `/api/v1/agents/{id}/audit` | ✓ | Audit trail |
| GET | `/api/v1/authorities/{id}` | ✓ | Get authority |
| PATCH | `/api/v1/authorities/{id}` | ✓ | Update authority |
| POST | `/api/v1/agents/{aid}/authorities/{auid}/revoke` | ✓ | Revoke key |
| GET | `/api/v1/terminations/{id}` | ✓ | Job status |
| POST | `/api/v1/terminations/{id}/retry` | ✓ | Retry job |
| GET | `/api/v1/receipts/{id}` | ✓ | (Priority 4c) |
| GET | `/api/v1/receipts/{id}/verify` | ✓ | (Priority 4c) |
| GET | `/api/v1/agents/{id}/receipt` | ✓ | (Priority 4c) |
