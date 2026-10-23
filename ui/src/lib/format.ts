/**
 * Formatting and state mapping utilities for Clean Exit.
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
  if (!isoString) return { local: '—', utc: '—', relative: '—' };
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return { local: isoString, utc: isoString, relative: '—' };
    const local = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
    const utc = date.toISOString();
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

export function formatAuditAction(action: string): string {
  const map: Record<string, string> = {
    termination_requested: 'Termination Requested',
    job_retried: 'Termination Retried',
    revocations_completed: 'Permissions Revoked',
    receipt_created: 'Receipt Generated',
    receipt_published: 'Receipt Published to Blockchain',
    job_completed: 'Termination Completed',
    agent_created: 'Agent Registered',
    authority_registered: 'Permission Registered',
  };
  if (map[action]) return map[action];
  return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function formatTargetType(type: string): string {
  const map: Record<string, string> = {
    termination_job: 'Job',
    receipt: 'Receipt',
    agent: 'Agent',
    authority: 'Permission',
  };
  if (map[type]) return map[type];
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function formatTriStateOnChain(onChain: boolean | null): { label: string; detail: string; variant: 'positive' | 'negative' | 'neutral' } {
  if (onChain === true) return { label: 'Confirmed on blockchain', detail: 'This permission was found on the NEAR network.', variant: 'positive' };
  if (onChain === false) return { label: 'Confirmed absent', detail: 'A successful network check confirmed this permission does not exist.', variant: 'negative' };
  return { label: 'Inconclusive', detail: 'Could not verify (network error or unsupported permission type).', variant: 'neutral' };
}

export function getAgentStatusMeta(status: AgentStatus) {
  switch (status) {
    case 'active': return { label: 'Active', description: 'Agent is running normally.', variant: 'emerald' as const, isTerminal: false };
    case 'termination_requested': return { label: 'Termination Requested', description: 'Shutdown is queued and waiting to start.', variant: 'amber' as const, isTerminal: false };
    case 'terminating': return { label: 'Terminating', description: 'Clean Exit is actively shutting down this agent.', variant: 'blue' as const, isTerminal: false };
    case 'clean': return { label: 'Clean', description: 'All registered permissions were successfully removed or confirmed absent.', variant: 'emerald' as const, isTerminal: true };
    case 'partial': return { label: 'Partial', description: 'Completed, but some permissions require manual cleanup.', variant: 'amber' as const, isTerminal: true };
    case 'failed': return { label: 'Failed', description: 'Termination could not be completed safely.', variant: 'crimson' as const, isTerminal: true };
    default: return { label: status, description: 'Unknown status.', variant: 'neutral' as const, isTerminal: false };
  }
}

export function getAuthorityStateMeta(state: AuthorityState) {
  switch (state) {
    case 'active': return { label: 'Active', description: 'Verified present on the blockchain.', variant: 'emerald' as const };
    case 'revocation_pending': return { label: 'Revocation Pending', description: 'Removal submitted; waiting for network confirmation.', variant: 'blue' as const };
    case 'revoked': return { label: 'Revoked', description: 'Successfully deleted by Clean Exit.', variant: 'emerald' as const };
    case 'expired': return { label: 'Expired', description: 'Not found on the blockchain (may have expired or been deleted elsewhere).', variant: 'neutral' as const };
    case 'unverified': return { label: 'Unverified', description: 'Registered by you, but not yet checked against the blockchain.', variant: 'amber' as const };
    case 'unsupported': return { label: 'Unsupported', description: 'Clean Exit cannot automatically verify or remove this permission type.', variant: 'neutral' as const };
    case 'failed': return { label: 'Revocation Failed', description: 'Attempted to revoke, but the transaction failed.', variant: 'crimson' as const };
    case 'requires_manual_action': return { label: 'Requires Manual Action', description: 'Transaction submitted, but could not be verified. Please check manually.', variant: 'amber' as const };
    default: return { label: state, description: 'Unknown state.', variant: 'neutral' as const };
  }
}

export function getAuthorityTypeMeta(type: AuthorityType | string) {
  switch (type) {
    case 'near_function_key': return { label: 'NEAR Access Key', description: 'A limited-permission key allowing the agent to interact with NEAR smart contracts.' };
    case 'contract_allowance': return { label: 'Contract Allowance', description: 'Prepaid gas or token allowance attached to an access key.' };
    case 'scheduled_job': return { label: 'Scheduled Job', description: 'An automated task or cron job granted to the agent.' };
    case 'external_credential': return { label: 'External Credential', description: 'An API key, OAuth token, or webhook secret granted to the agent.' };
    case 'obligation': return { label: 'Pending Obligation', description: 'An unresolved financial or operational commitment (e.g., escrow).' };
    case 'child_delegation': return { label: 'Child Agent', description: 'A sub-agent or downstream process this agent granted permissions to.' };
    default: return { label: type, description: 'Registered capability or permission.' };
  }
}

export function getJobPhaseMeta(phase: JobPhase) {
  const phases: Record<JobPhase, { label: string; order: number; description: string }> = {
    validate: { order: 1, label: 'Validate', description: 'Checking agent ownership and prerequisites.' },
    inventory: { order: 2, label: 'Inventory', description: 'Gathering the list of registered permissions.' },
    plan: { order: 3, label: 'Plan', description: 'Determining the safest order to remove them.' },
    revoke: { order: 4, label: 'Revoke', description: 'Deleting keys on the blockchain.' },
    resolve_obligations: { order: 5, label: 'Resolve Obligations', description: 'Checking for pending tasks or manual cleanup needs.' },
    verify: { order: 6, label: 'Verify', description: 'Re-checking the blockchain to confirm deletion.' },
    finalize: { order: 7, label: 'Finalize', description: 'Generating the final termination receipt.' },
    complete: { order: 8, label: 'Complete', description: 'Termination job finished.' },
  };
  return phases[phase] || { label: phase, order: 0, description: '' };
}

export function getJobStatusMeta(status: JobStatus) {
  switch (status) {
    case 'pending': return { label: 'Pending', variant: 'neutral' as const };
    case 'running': return { label: 'Running', variant: 'blue' as const };
    case 'succeeded': return { label: 'Succeeded', variant: 'emerald' as const };
    case 'partial': return { label: 'Partial', variant: 'amber' as const };
    case 'failed': return { label: 'Failed', variant: 'crimson' as const };
    case 'cancelled': return { label: 'Cancelled', variant: 'neutral' as const };
    default: return { label: status, variant: 'neutral' as const };
  }
}

export function getReceiptResultMeta(result: ReceiptResult) {
  switch (result) {
    case 'clean': return { label: 'Clean Termination', description: 'All registered permissions were successfully removed or confirmed absent.', variant: 'emerald' as const };
    case 'partial': return { label: 'Partial Termination', description: 'Some permissions could not be removed automatically and require manual cleanup.', variant: 'amber' as const };
    case 'failed': return { label: 'Termination Failed', description: 'Clean Exit could not complete the termination safely.', variant: 'crimson' as const };
  }
}

export function getTerminationActionMeta(action: TerminationAction) {
  switch (action) {
    case 'revoke': return { label: 'On-Chain Revoke', description: 'Deletes the access key directly from the blockchain.', badge: 'Blockchain' };
    case 'registry_revoke': return { label: 'Registry Revoke', description: 'Removes the permission internally; no blockchain transaction needed.', badge: 'Internal' };
    case 'verify': return { label: 'Re-Verify', description: 'Checks the blockchain to confirm it is gone.', badge: 'Read-Only' };
    case 'manual': return { label: 'Manual Action', description: 'Requires you to clean this up manually.', badge: 'Manual Todo' };
    case 'skip': return { label: 'Skip', description: 'Excluded from termination.', badge: 'Out of Scope' };
  }
}

export function truncateString(str: string, maxLen = 32): string {
  if (!str || str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, half)}...${str.slice(-half)}`;
}