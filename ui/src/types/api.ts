/**
 * Clean Exit API TypeScript Definitions
 * Spec: API contract v1 (schema_version: 1)
 */

export type AgentStatus =
  | 'active'
  | 'termination_requested'
  | 'terminating'
  | 'clean'
  | 'partial'
  | 'failed';

export type AuthorityType =
  | 'near_function_key'
  | 'contract_allowance'
  | 'scheduled_job'
  | 'external_credential'
  | 'obligation'
  | 'child_delegation';

export type AuthorityState =
  | 'active'
  | 'revocation_pending'
  | 'revoked'
  | 'expired'
  | 'unverified'
  | 'unsupported'
  | 'failed'
  | 'requires_manual_action';

export type AuthoritySource = 'registered' | 'discovered';

export type TerminationAction =
  | 'revoke'
  | 'registry_revoke'
  | 'verify'
  | 'manual'
  | 'skip';

export type TerminationSupport = 'supported' | 'partial' | 'unsupported';

export type JobPhase =
  | 'validate'
  | 'inventory'
  | 'plan'
  | 'revoke'
  | 'resolve_obligations'
  | 'verify'
  | 'finalize'
  | 'complete';

export type JobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type ReceiptResult = 'clean' | 'partial' | 'failed';

export type VerificationStatus =
  | 'not_published'
  | 'pending'
  | 'published'
  | 'verification_failed';

export interface CapabilitiesResponse {
  network: string;
  signer_configured: boolean;
  signer_reason:
    | 'ok'
    | 'signer_unavailable'
    | 'signer_invalid'
    | 'mainnet_signing_forbidden_in_non_production'
    | string;
  receipt_publisher_configured: boolean;
  contract_configured: boolean;
  rate_limit_enabled: boolean;
  authority_types_registered: AuthorityType[];
  authority_types_revocable: AuthorityType[];
  authority_types_verifiable: AuthorityType[];
}

export interface Agent {
  id: string;
  name: string;
  near_account: string | null;
  environment: 'testnet' | 'mainnet' | string;
  description: string | null;
  status: AgentStatus;
  meta: Record<string, unknown>;
  created_at: string;
  last_activity_at: string;
}

export interface AgentCreateInput {
  name: string;
  near_account?: string | null;
  environment?: 'testnet' | 'mainnet';
  description?: string | null;
  meta?: Record<string, unknown>;
}

export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface Authority {
  id: string;
  agent_id: string;
  type: AuthorityType;
  provider: string;
  resource: string;
  parent_id: string | null;
  scope: Record<string, unknown>;
  revocable: boolean;
  source: AuthoritySource;
  state: AuthorityState;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface AuthorityCreateInput {
  type: AuthorityType;
  provider: string;
  resource: string;
  parent_id?: string | null;
  scope?: Record<string, unknown>;
  revocable?: boolean;
  source?: AuthoritySource;
  meta?: Record<string, unknown>;
}

export interface AuthorityUpdateInput {
  scope?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  revocable?: boolean;
}

export interface AuthorityNode {
  authority: Authority;
  children: AuthorityNode[];
}

export interface AuthorityGraphResponse {
  agent_id: string;
  roots: AuthorityNode[];
  orphaned: Authority[];
}

export interface VerifiedAuthorityItem {
  authority_id: string;
  type: AuthorityType | string;
  resource: string;
  previous_state: AuthorityState | string;
  new_state: AuthorityState | string;
  on_chain: boolean | null;
  detail: string;
}

export interface SkippedAuthorityItem {
  authority_id: string;
  type: AuthorityType | string;
  resource: string;
  previous_state: AuthorityState | string;
  new_state: AuthorityState | string;
  on_chain: boolean | null;
  detail: string;
}

export interface VerifyResponse {
  agent_id: string;
  near_account: string | null;
  checked_at: string;
  account_exists: boolean;
  total_observed_keys: number;
  verified: VerifiedAuthorityItem[];
  skipped: SkippedAuthorityItem[];
  error: string | null;
}

export interface TerminationStep {
  order: number;
  authority_id: string;
  type: AuthorityType | string;
  resource: string;
  action: TerminationAction;
  support: TerminationSupport;
  required_authorization: string;
  depends_on: string[];
  risk: string | null;
  verification: string;
}

export interface TerminationPlan {
  agent_id: string;
  near_account: string | null;
  network: string;
  total_authorities: number;
  supported_count: number;
  unsupported_count: number;
  manual_count: number;
  steps: TerminationStep[];
  notes: string[];
}

export interface TerminationJob {
  id: string;
  agent_id: string;
  reason: string | null;
  phase: JobPhase;
  status: JobStatus;
  retry_count: number;
  error: string | null;
  receipt_id: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TerminationRequestInput {
  reason?: string;
  idempotency_key?: string;
}

export interface Receipt {
  id: string;
  agent_id: string;
  agent_near_account: string;
  network: string;
  result: ReceiptResult;
  schema_version: number;
  payload: Record<string, unknown>;
  payload_hash: string;
  onchain_tx_hash: string | null;
  verification_status: VerificationStatus;
  requested_at: string;
  completed_at: string;
  published_at: string | null;
}

export interface ReceiptVerifyResponse {
  receipt_id: string;
  payload_hash: string;
  recomputed_hash: string;
  hash_matches: boolean;
  onchain_status: string;
  onchain_tx_hash: string | null;
  onchain_hash: string | null;
  onchain_matches: boolean;
  verified: boolean;
  notes: string[];
}

export interface AuditEvent {
  id: number;
  agent_id: string;
  actor_owner_id: string | null;
  action:
    | 'termination_requested'
    | 'job_retried'
    | 'revocations_completed'
    | 'receipt_created'
    | 'job_completed'
    | string;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ApiValidationError {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: { error?: string; [key: string]: unknown };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: {
      errors?: ApiValidationError[];
      [key: string]: unknown;
    };
    request_id?: string;
  };
}
