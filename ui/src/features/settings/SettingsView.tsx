import React from 'react';
import {
  RefreshCw,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  Server,
  Info,
} from 'lucide-react';
import { useConnection } from '../../context/ConnectionContext.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';

export function SettingsView() {
  const {
    baseUrl,
    token,
    capabilities,
    isLoadingCapabilities,
    capabilitiesError,
    refreshCapabilities,
    disconnect,
  } = useConnection();

  const maskedToken = token ? `${token.slice(0, 6)}...${token.slice(-4)}` : 'None';

  return (
    <div className="space-y-6 max-w-[var(--content-max-width)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] leading-[1.25]">
            Settings & API connection
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            Backend endpoint configuration, token status, and discovered capabilities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refreshCapabilities()}
            disabled={isLoadingCapabilities}
            className="btn-secondary"
          >
            <RefreshCw size={13} className={isLoadingCapabilities ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="btn-danger"
          >
            <LogOut size={13} />
            <span>Disconnect</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={capabilitiesError} title="Capabilities Query Error" />

      {/* Session Credentials Card */}
      <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
          Connection session
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
              Backend base URL
            </span>
            <span className="font-mono text-[var(--text-primary)] break-all">{baseUrl}</span>
          </div>

          <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
              Session token (Masked)
            </span>
            <span className="font-mono text-[var(--text-primary)]">{maskedToken}</span>
          </div>
        </div>

        <p className="text-[12px] text-[var(--text-muted)]">
          The API token is kept strictly in session memory and is never logged or persisted in permanent browser storage.
        </p>
      </div>

      {/* Discovered Capabilities */}
      {capabilities && (
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Discovered capabilities
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13px]">
            {/* Network */}
            <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
              <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
                Network
              </span>
              <span className="text-[15px] font-semibold text-[var(--text-primary)] uppercase font-mono">
                NEAR {capabilities.network}
              </span>
            </div>

            {/* Signer */}
            <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
              <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
                Signer status
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    capabilities.signer_configured ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)]'
                  }`}
                />
                <span className="font-medium text-[var(--text-primary)]">
                  {capabilities.signer_configured ? 'Configured' : 'Unavailable'}
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                {capabilities.signer_reason}
              </div>
            </div>

            {/* Receipt Publisher */}
            <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
              <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
                On-chain receipt publisher
              </span>
              <span className="font-medium text-[var(--text-muted)]">
                {capabilities.receipt_publisher_configured ? 'Configured' : 'Pending (Priority 4)'}
              </span>
              <div className="text-[11px] text-[var(--text-muted)]">
                {capabilities.contract_configured ? 'Registry contract set' : 'Contract unset'}
              </div>
            </div>
          </div>

          {/* Raw JSON */}
          <div className="space-y-1.5 pt-2">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider font-mono">
              Raw response (/api/v1/capabilities)
            </span>
            <CodeSnippet code={capabilities} maxHeight="max-h-48" />
          </div>
        </div>
      )}
    </div>
  );
}
