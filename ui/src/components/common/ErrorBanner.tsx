import React from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError } from '../../lib/api-client.ts';

interface ErrorBannerProps {
  error: unknown | null;
  title?: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, title = 'Error', onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  let message = 'An unexpected error occurred.';
  let code: string | null = null;

  if (error instanceof ApiError) {
    message = error.message;
    // Hide generic codes from the user
    if (error.code && error.code !== 'unknown_error' && error.code !== 'http_error') {
      code = error.code;
    }
  } else if (error instanceof Error) {
    message = error.message;
    // Translate the raw browser network error
    if (message === 'Failed to fetch' || message.includes('NetworkError')) {
      message = 'Could not connect to the server. Please ensure the backend is running and the URL is correct.';
    }
  } else if (typeof error === 'string') {
    message = error;
  }

  return (
    <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-900/50 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-rose-200">
            {title}
          </h4>
          <p className="text-sm text-rose-300/90 mt-1 leading-relaxed">
            {message}
          </p>
          {code && (
            <p className="text-[11px] font-mono text-rose-400/60 mt-1.5">
              Code: {code}
            </p>
          )}
        </div>
      </div>
      
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-400 hover:text-rose-200 text-xs font-medium px-2 py-1"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}