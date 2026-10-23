import React from 'react';
import { formatTriStateOnChain } from '../../lib/format.ts';

interface TriStateBadgeProps {
  onChain: boolean | null;
  size?: 'sm' | 'md';
}

export function TriStateBadge({ onChain }: TriStateBadgeProps) {
  const meta = formatTriStateOnChain(onChain);

  if (onChain === true) {
    return (
      <span
        title={meta.detail}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border border-[var(--status-success)]/20 bg-[var(--status-success-bg)] text-[var(--status-success)] text-[11px] font-medium leading-none whitespace-nowrap"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }

  if (onChain === false) {
    return (
      <span
        title={meta.detail}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border border-[var(--status-danger)]/20 bg-[var(--status-danger-bg)] text-[var(--status-danger)] text-[11px] font-medium leading-none whitespace-nowrap"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-danger)] shrink-0" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }

  // onChain === null -> Unknown / Not verified
  return (
    <span
      title={meta.detail}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--status-neutral-bg)] text-[var(--text-muted)] text-[11px] font-medium leading-none whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
