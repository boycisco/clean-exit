import React from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError } from '../../lib/api-client.ts';

interface ErrorBannerProps {
  error?: unknown;
  title?: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, title = 'Operation Failed', onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  let message = 'An unexpected error occurred.';
  let code = 'unknown_error';
  let requestId: string | undefined;
  let validationErrors: Array<{ loc: (string | number)[]; msg: string }> = [];

  if (error instanceof ApiError) {
    message = error.message;
    code = error.code;
    requestId = error.requestId;
    if (error.details && Array.isArray((error.details as any).errors)) {
      validationErrors = (error.details as any).errors;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--status-danger)]/25 bg-[var(--status-danger-bg)] p-3.5 text-[13px] text-[var(--status-danger)]">
      <div className="flex items-start gap-2.5">
        <AlertCircle size={15} className="shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--text-primary)]">{title}</span>
            <span className="font-mono text-[11px] text-[var(--status-danger)]/80 bg-black/30 px-1.5 py-0.5 rounded-[var(--radius-sm)]">
              {code}
            </span>
          </div>
          <p className="text-[12px] text-[var(--status-danger)]/90 leading-normal">{message}</p>

          {validationErrors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-4 list-disc text-[12px]">
              {validationErrors.map((v, i) => (
                <li key={i}>
                  <strong className="font-mono text-[11px]">{v.loc.join('.')}</strong>: {v.msg}
                </li>
              ))}
            </ul>
          )}

          {requestId && (
            <div className="pt-0.5 text-[10px] text-[var(--text-muted)] font-mono">
              Request ID: {requestId}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[12px] opacity-70 hover:opacity-100 text-[var(--text-primary)] px-1"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
