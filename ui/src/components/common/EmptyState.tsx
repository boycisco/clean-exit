import React from 'react';
import { LucideIcon, ShieldAlert } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  warningNote?: string;
}

export function EmptyState({
  icon: Icon = ShieldAlert,
  title,
  description,
  action,
  warningNote,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] max-w-lg mx-auto my-6">
      <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] mb-3">
        <Icon size={18} />
      </div>
      <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h4>
      <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 max-w-md leading-relaxed">
        {description}
      </p>

      {warningNote && (
        <div className="mt-3.5 px-3 py-2 bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/20 rounded-[var(--radius-sm)] text-left text-[12px] text-[var(--status-warning)] leading-normal max-w-md">
          <span className="font-semibold">Note: </span>
          {warningNote}
        </div>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
