import React from 'react';
import {
  getAgentStatusMeta,
  getAuthorityStateMeta,
  getJobStatusMeta,
  getReceiptResultMeta,
} from '../../lib/format.ts';
import type {
  AgentStatus,
  AuthorityState,
  JobStatus,
  ReceiptResult,
} from '../../types/api.ts';

interface StatusBadgeProps {
  type: 'agent' | 'authority' | 'job' | 'receipt' | 'custom';
  value: string;
  customLabel?: string;
  customVariant?: 'emerald' | 'amber' | 'crimson' | 'neutral' | 'blue';
  size?: 'sm' | 'md';
}

export function StatusBadge({
  type,
  value,
  customLabel,
  customVariant,
  size = 'md',
}: StatusBadgeProps) {
  let label = customLabel || value;
  let variant: 'emerald' | 'amber' | 'crimson' | 'neutral' | 'blue' =
    customVariant || 'neutral';

  if (type === 'agent') {
    const meta = getAgentStatusMeta(value as AgentStatus);
    label = meta.label;
    variant = meta.variant;
  } else if (type === 'authority') {
    const meta = getAuthorityStateMeta(value as AuthorityState);
    label = meta.label;
    variant = meta.variant;
  } else if (type === 'job') {
    const meta = getJobStatusMeta(value as JobStatus);
    label = meta.label;
    variant = meta.variant;
  } else if (type === 'receipt') {
    const meta = getReceiptResultMeta(value as ReceiptResult);
    label = meta.label;
    variant = meta.variant;
  }

  // Exact dot colors corresponding to spec
  const dotColor = {
    emerald: 'bg-[var(--status-success)]',
    amber: 'bg-[var(--status-warning)]',
    crimson: 'bg-[var(--status-danger)]',
    blue: 'bg-[var(--accent)]',
    neutral: 'bg-[var(--status-neutral)]',
  }[variant];

  const textColor = {
    emerald: 'text-[var(--status-success)]',
    amber: 'text-[var(--status-warning)]',
    crimson: 'text-[var(--status-danger)]',
    blue: 'text-[var(--accent)]',
    neutral: 'text-[var(--text-secondary)]',
  }[variant];

  const bgColor = {
    emerald: 'bg-[var(--status-success-bg)] border-[var(--status-success)]/20',
    amber: 'bg-[var(--status-warning-bg)] border-[var(--status-warning)]/20',
    crimson: 'bg-[var(--status-danger-bg)] border-[var(--status-danger)]/20',
    blue: 'bg-[var(--accent-muted)] border-[var(--accent)]/20',
    neutral: 'bg-[var(--status-neutral-bg)] border-[var(--border-subtle)]',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border text-[11px] font-medium leading-none whitespace-nowrap ${bgColor} ${textColor}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
