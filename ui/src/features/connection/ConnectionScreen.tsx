import React, { useState } from 'react';
import { useConnection } from '../../context/ConnectionContext.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { DEFAULT_API_BASE_URL } from '../../lib/auth-storage.ts';

interface ConnectionScreenProps {
  onConnected?: () => void;
}

export function ConnectionScreen({ onConnected }: ConnectionScreenProps) {
  const { baseUrl: currentBaseUrl, connect, capabilitiesError } = useConnection();
  const [baseUrlInput, setBaseUrlInput] = useState(currentBaseUrl || DEFAULT_API_BASE_URL);
  const [tokenInput, setTokenInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<unknown | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const cleanToken = tokenInput.trim();
    const cleanUrl = baseUrlInput.trim().replace(/\/+$/, '');

    if (!cleanToken) {
      setLocalError(new Error('Access Token is required.'));
      return;
    }

    if (!cleanUrl) {
      setLocalError(new Error('Server Address is required.'));
      return;
    }

    setIsSubmitting(true);
    try {
      await connect(cleanToken, cleanUrl);
      if (onConnected) {
        onConnected();
      }
    } catch (err: unknown) {
      setLocalError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-[480px] space-y-6">
        {/* Brand Lockup */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-[4px] bg-[var(--accent)] flex items-center justify-center shrink-0">
              <div className="w-2.5 h-2.5 bg-[var(--accent-text)] rounded-[1.5px]" />
            </div>
            <span className="text-[18px] font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
              clean exit
            </span>
          </div>
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">
            Connect to Clean Exit
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] leading-normal">
            Enter your Clean Exit server details to continue.
          </p>
        </div>

        {/* Connection Form */}
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-lg)] bg-[var(--bg-surface)] p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="base-url" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
                Server Address
              </label>
              <input
                id="base-url"
                type="text"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
                required
              />
              <p className="text-[11px] text-[var(--text-muted)]">
                Default local server: http://127.0.0.1:8000
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="api-token" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
                Access Token
              </label>
              <input
                id="api-token"
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="ce_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
                required
                autoComplete="off"
              />
              <p className="text-[11px] text-[var(--text-muted)]">
                Your token is kept securely in memory and never saved to disk.
              </p>
            </div>

            {(localError || capabilitiesError) && (
              <ErrorBanner
                error={localError || capabilitiesError}
                title="Connection failed"
                onDismiss={() => setLocalError(null)}
              />
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full"
            >
              {isSubmitting ? 'Verifying connection...' : 'Connect'}
            </button>
          </form>

          <div className="p-3 bg-[var(--bg-app)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-muted)] space-y-1">
            <span className="text-[var(--text-secondary)] font-medium block">
              Security
            </span>
            <p className="leading-relaxed">
              Your access token determines which agents you can see and manage. It is never transmitted to any third-party service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}