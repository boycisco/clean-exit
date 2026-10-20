from __future__ import annotations

import json
import re
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Enums (stored as TEXT in the database for portability)
# ---------------------------------------------------------------------------

class AgentStatus(StrEnum):
    ACTIVE = "active"
    TERMINATION_REQUESTED = "termination_requested"
    TERMINATING = "terminating"
    CLEAN = "clean"
    PARTIAL = "partial"
    FAILED = "failed"


class AuthorityType(StrEnum):
    NEAR_FUNCTION_KEY = "near_function_key"
    CONTRACT_ALLOWANCE = "contract_allowance"
    SCHEDULED_JOB = "scheduled_job"
    EXTERNAL_CREDENTIAL = "external_credential"
    OBLIGATION = "obligation"
    CHILD_DELEGATION = "child_delegation"


class AuthorityState(StrEnum):
    ACTIVE = "active"
    REVOCATION_PENDING = "revocation_pending"
    REVOKED = "revoked"
    EXPIRED = "expired"
    UNVERIFIED = "unverified"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"
    REQUIRES_MANUAL_ACTION = "requires_manual_action"


class AuthoritySource(StrEnum):
    REGISTERED = "registered"
    DISCOVERED = "discovered"


class Environment(StrEnum):
    TESTNET = "testnet"
    MAINNET = "mainnet"


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobPhase(StrEnum):
    VALIDATE = "validate"
    INVENTORY = "inventory"
    PLAN = "plan"
    REVOKE = "revoke"
    RESOLVE_OBLIGATIONS = "resolve_obligations"
    VERIFY = "verify"
    FINALIZE = "finalize"
    COMPLETE = "complete"


class ReceiptResult(StrEnum):
    CLEAN = "clean"
    PARTIAL = "partial"
    FAILED = "failed"


class VerificationStatus(StrEnum):
    NOT_PUBLISHED = "not_published"
    PENDING = "pending"
    PUBLISHED = "published"
    VERIFICATION_FAILED = "verification_failed"


# ---------------------------------------------------------------------------
# NEAR account ID validation
# ---------------------------------------------------------------------------

_ACCOUNT_RE = re.compile(r"^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$")
_IMPLICIT_RE = re.compile(r"^[0-9a-f]{64}$")


def is_valid_near_account(value: str) -> bool:
    """Validate a NEAR account ID against current protocol rules.

    Rules:
      - 2..64 characters
      - lowercase a-z, digits 0-9, and - _ . (separators)
      - separators must not appear at start, end, or consecutively
      - 64 lowercase hex chars = implicit account (also valid)
    """
    if not isinstance(value, str):
        return False
    if not 2 <= len(value) <= 64:
        return False
    if _IMPLICIT_RE.fullmatch(value):
        return True
    return bool(_ACCOUNT_RE.fullmatch(value))


# ---------------------------------------------------------------------------
# Base model
# ---------------------------------------------------------------------------

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _check_json_size(payload: dict[str, Any], limit: int, label: str) -> None:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > limit:
        raise ValueError(f"{label} must be <= {limit} bytes when serialized")


# ---------------------------------------------------------------------------
# Owner
# ---------------------------------------------------------------------------

class OwnerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class AgentCreate(StrictModel):
    name: str = Field(min_length=1, max_length=128)
    near_account: str | None = Field(default=None, max_length=64)
    environment: Environment = Environment.TESTNET
    description: str | None = Field(default=None, max_length=4096)
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("near_account")
    @classmethod
    def _near_account(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not is_valid_near_account(v):
            raise ValueError("invalid NEAR account ID")
        return v

    @field_validator("meta")
    @classmethod
    def _meta_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        _check_json_size(v, 4096, "meta")
        return v


class AgentUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=4096)
    meta: dict[str, Any] | None = None

    @field_validator("meta")
    @classmethod
    def _meta_size(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            _check_json_size(v, 4096, "meta")
        return v


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    near_account: str | None
    environment: Environment
    description: str | None
    status: AgentStatus
    meta: dict[str, Any]
    created_at: datetime
    last_activity_at: datetime


# ---------------------------------------------------------------------------
# Authority
# ---------------------------------------------------------------------------

class AuthorityCreate(StrictModel):
    type: AuthorityType
    provider: str = Field(min_length=1, max_length=64)
    resource: str = Field(min_length=1, max_length=512)
    parent_id: str | None = None
    scope: dict[str, Any] = Field(default_factory=dict)
    revocable: bool = False
    source: AuthoritySource = AuthoritySource.REGISTERED
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("scope")
    @classmethod
    def _scope_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        _check_json_size(v, 4096, "scope")
        return v

    @field_validator("meta")
    @classmethod
    def _meta_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        _check_json_size(v, 4096, "meta")
        return v


class AuthorityUpdate(StrictModel):
    scope: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None
    revocable: bool | None = None


class AuthorityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    agent_id: str
    parent_id: str | None
    type: AuthorityType
    provider: str
    resource: str
    scope: dict[str, Any]
    revocable: bool
    state: AuthorityState
    source: AuthoritySource
    last_verified_at: datetime | None
    meta: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AuthorityNode(BaseModel):
    authority: AuthorityRead
    children: list["AuthorityNode"] = Field(default_factory=list)


class AuthorityGraph(BaseModel):
    agent_id: str
    roots: list[AuthorityNode]
    orphaned: list[AuthorityRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Termination
# ---------------------------------------------------------------------------

class TerminationCreate(StrictModel):
    reason: str | None = Field(default=None, max_length=2048)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class TerminationJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    agent_id: str
    reason: str | None
    phase: JobPhase
    status: JobStatus
    retry_count: int
    error: dict[str, Any] | None
    receipt_id: str | None
    requested_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


# ---------------------------------------------------------------------------
# Receipts
# ---------------------------------------------------------------------------

class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    agent_id: str
    agent_near_account: str | None
    network: Environment
    result: ReceiptResult
    schema_version: int
    payload: dict[str, Any]
    payload_hash: str
    onchain_tx_hash: str | None
    verification_status: VerificationStatus
    requested_at: datetime
    completed_at: datetime
    published_at: datetime | None


class ReceiptVerifyResult(BaseModel):
    receipt_id: str
    payload_hash: str
    recomputed_hash: str
    hash_matches: bool
    onchain_status: VerificationStatus
    onchain_tx_hash: str | None
    onchain_hash: str | None
    onchain_matches: bool | None
    verified: bool
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    agent_id: str | None
    actor_owner_id: str | None
    action: str
    target_type: str | None
    target_id: str | None
    payload: dict[str, Any]
    created_at: datetime


# ---------------------------------------------------------------------------
# Meta endpoints
# ---------------------------------------------------------------------------

class Capabilities(BaseModel):
    network: Environment
    signer_configured: bool
    signer_reason: str
    receipt_publisher_configured: bool
    contract_configured: bool
    rate_limit_enabled: bool
    authority_types_registered: list[AuthorityType]
    authority_types_revocable: list[AuthorityType]


class Health(BaseModel):
    status: str
    database: str
    near_rpc: str
    version: str