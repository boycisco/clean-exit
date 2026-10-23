/**
 * Formatting and state mapping utilities for Clean Exit.
 * Enforces zero-pill visual discipline, accurate tri-state chain interpretations,
 * and dual local/UTC timestamp formatting.
 */

import type {
  AgentStatus,
  AuthorityState,
  AuthorityType,
  JobPhase,
  JobStatus,
  ReceiptResult,
  TerminationAction,
} from '../types/api.ts';

export function formatDateTime(isoString: string | null | undefined): {
  local: string;
  utc: string;
  relative: string;
} {
  if (!isoString) {
    return { local: '—', utc: '—', relative: '—' };
  }

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return { local: isoString, utc: isoString, relative: '—' };
    }

    const local = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date);

    const utc = date.toISOString();

    // Compute relative time
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    let relative = 'just now';
    if (diffDay > 0) relative = `${diffDay}d ago`;
    else if (diffHour > 0) relative = `${diffHour}h ago`;
    else if (diffMin > 0) relative = `${diffMin}m ago`;
    else if (diffSec > 10) relative = `${diffSec}s ago`;

    return { local, utc, relative };
  } catch {
    return { local: isoString, utc: isoString, relative: '—' };
  }
}

export function formatTriStateOnChain(onChain: boolean | null): {
  label: string;
  detail: string;
  variant: 'positive' | 'negative' | 'neutral';
} {
  if (onChain === true) {
    return {
      label: 'Observed on-chain',
      detail: 'Public key or permission confirmed active on NEAR RPC',
      variant: 'positive',
    };
  }
  if (onChain === false) {
    return {
      label: 'Confirmed absent',
      detail: 'RPC query succeeded and key/permission was not found',
      variant: 'negative',
    };
  }
  return {
    label: 'Inconclusive / Unknown',
    detail: 'Verification was unsupported, RPC error occurred, or account not queried',
    variant: 'neutral',
  };
}

export function getAgentStatusMeta(status: AgentStatus): {
  label: string;
  description: string;
  variant: 'emerald' | 'amber' | 'crimson' | 'neutral' | 'blue';
  isTerminal: boolean;
} {
  switch (status) {
    case 'active':
      return {
        label: 'Active',
        description: 'Agent is running normally with registered authorities.',
        variant: 'emerald',
        isTerminal: false,
      };
    case 'termination_requested':
      return {
        label: 'Termination Requested',
        description: 'Termination job queued; pending worker pickup.',
        variant: 'amber',
        isTerminal: false,
      };
    case 'terminating':
      return {
        label: 'Terminating',
        description: 'Worker is actively executing termination phases.',
        variant: 'blue',
        isTerminal: false,
      };
    case 'clean':
      return {
        label: 'Clean',
        description: 'Every registered authority in scope was revoked or confirmed absent.',
        variant: 'emerald',
        isTerminal: true,
      };
    case 'partial':
      return {
        label: 'Partial',
        description: 'Completed with unresolved, unsupported, or manual authorities.',
        variant: 'amber',
        isTerminal: true,
      };
    case 'failed':
      return {
        label: 'Failed',
        description: 'Termination aborted or could not establish a trustworthy outcome.',
        variant: 'crimson',
        isTerminal: true,
      };
    default:
      return {
        label: status,
        description: 'Unknown agent lifecycle status.',
        variant: 'neutral',
        isTerminal: false,
      };
  }
}

export function getAuthorityStateMeta(state: AuthorityState): {
  label: string;
  description: string;
  variant: 'emerald' | 'amber' | 'crimson' | 'neutral' | 'blue';
} {
  switch (state) {
    case 'active':
      return {
        label: 'Active',
        description: 'Verified present on chain, or active registered permission.',
        variant: 'emerald',
      };
    case 'revocation_pending':
      return {
        label: 'Revocation Pending',
        description: 'Revocation transaction submitted; pending confirmation.',
        variant: 'blue',
      };
    case 'revoked':
      return {
        label: 'Revoked',
        description: 'Confirmed absent following a successful Clean Exit revocation transaction.',
        variant: 'emerald',
      };
    case 'expired':
      return {
        label: 'Expired',
        description: 'Verified absent on chain before Clean Exit intervention or through external expiration.',
        variant: 'neutral',
      };
    case 'unverified':
      return {
        label: 'Unverified',
        description: 'Operator registered; not yet reconciled against chain state.',
        variant: 'amber',
      };
    case 'unsupported':
      return {
        label: 'Unsupported',
        description: 'This authority type cannot be verified or revoked automatically by this deployment.',
        variant: 'neutral',
      };
    case 'failed':
      return {
        label: 'Revocation Failed',
        description: 'Revocation transaction was attempted and did not succeed.',
        variant: 'crimson',
      };
    case 'requires_manual_action':
      return {
        label: 'Requires Manual Action',
        description: 'Transaction submitted but post-check was inconclusive; operator must manually verify.',
        variant: 'amber',
      };
    default:
      return {
        label: state,
        description: 'Unknown authority state.',
        variant: 'neutral',
      };
  }
}

export function getAuthorityTypeMeta(type: AuthorityType | string): {
  label: string;
  description: string;
} {
  switch (type) {
    case 'near_function_key':
      return {
        label: 'NEAR Function Call Key',
        description: 'Limited-access cryptographic key for calling specific smart contract methods.',
      };
    case 'contract_allowance':
      return {
        label: 'Contract Gas / Token Allowance',
        description: 'Prepaid allowance attached to an access key.',
      };
    case 'scheduled_job':
      return {
        label: 'Scheduled Cron / Deferred Job',
        description: 'Off-chain or on-chain automated trigger executing on a periodic schedule.',
      };
    case 'external_credential':
      return {
        label: 'External API Credential',
        description: 'API key, OAuth token, or webhook secret granted to the agent.',
      };
    case 'obligation':
      return {
        label: 'Financial / Operational Obligation',
        description: 'Unresolved debt, active escrow, or pending settlement commitment.',
      };
    case 'child_delegation':
      return {
        label: 'Child Agent Delegation',
        description: 'Sub-authority granted by this agent to an autonomous downstream agent.',
      };
    default:
      return {
        label: type,
        description: 'Registered capability or permission identifier.',
      };
  }
}

export function getJobPhaseMeta(phase: JobPhase): {
  label: string;
  order: number;
  description: string;
} {
  const phases: Record<JobPhase, { label: string; order: number; description: string }> = {
    validate: { order: 1, label: 'Validate', description: 'Verifying agent ownership, signer availability, and preconditions.' },
    inventory: { order: 2, label: 'Inventory', description: 'Traversing the registered authority graph and dependencies.' },
    plan: { order: 3, label: 'Plan', description: 'Generating post-order dependency sequence (children before parents).' },
    revoke: { order: 4, label: 'Revoke', description: 'Submitting on-chain revocation transactions for supported authorities.' },
    resolve_obligations: { order: 5, label: 'Resolve Obligations', description: 'Checking outstanding liabilities and recording manual action flags.' },
    verify: { order: 6, label: 'Verify', description: 'Re-querying NEAR RPC to confirm key deletion on-chain.' },
    finalize: { order: 7, label: 'Finalize', description: 'Compiling canonical termination receipt and payload hash.' },
    complete: { order: 8, label: 'Complete', description: 'Termination job finished.' },
  };
  return phases[phase] || { label: phase, order: 0, description: '' };
}

export function getJobStatusMeta(status: JobStatus): {
  label: string;
  variant: 'emerald' | 'amber' | 'crimson' | 'neutral' | 'blue';
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending', variant: 'neutral' };
    case 'running':
      return { label: 'Running', variant: 'blue' };
    case 'succeeded':
      return { label: 'Succeeded', variant: 'emerald' };
    case 'partial':
      return { label: 'Partial', variant: 'amber' };
    case 'failed':
      return { label: 'Failed', variant: 'crimson' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'neutral' };
    default:
      return { label: status, variant: 'neutral' };
  }
}

export function getReceiptResultMeta(result: ReceiptResult): {
  label: string;
  description: string;
  variant: 'emerald' | 'amber' | 'crimson';
} {
  switch (result) {
    case 'clean':
      return {
        label: 'Clean Termination',
        description: 'Every registered authority in scope was verified revoked or absent.',
        variant: 'emerald',
      };
    case 'partial':
      return {
        label: 'Partial Termination',
        description: 'Some authorities could not be revoked or require manual operator action.',
        variant: 'amber',
      };
    case 'failed':
      return {
        label: 'Termination Failed',
        description: 'The termination could not establish a trustworthy outcome.',
        variant: 'crimson',
      };
  }
}

export function getTerminationActionMeta(action: TerminationAction): {
  label: string;
  description: string;
  badge: string;
} {
  switch (action) {
    case 'revoke':
      return {
        label: 'On-Chain Revoke',
        description: 'Submits NEAR transaction to delete access key from account.',
        badge: 'On-Chain Tx',
      };
    case 'registry_revoke':
      return {
        label: 'Registry Revoke',
        description: 'Marks authority revoked internally; no blockchain transaction needed.',
        badge: 'Internal',
      };
    case 'verify':
      return {
        label: 'Re-Verify',
        description: 'Queries chain state to confirm absence without submitting a write transaction.',
        badge: 'Read-Only',
      };
    case 'manual':
      return {
        label: 'Manual Action',
        description: 'Cannot be automated by this deployment; requires operator intervention.',
        badge: 'Manual Todo',
      };
    case 'skip':
      return {
        label: 'Skip',
        description: 'Explicitly excluded from termination scope.',
        badge: 'Out of Scope',
      };
  }
}

export function truncateString(str: string, maxLen = 32): string {
  if (!str || str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, half)}...${str.slice(-half)}`;
}
