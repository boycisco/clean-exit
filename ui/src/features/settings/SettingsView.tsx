import React, { useState } from 'react';
import {
  RefreshCw,
  LogOut,
  ShieldCheck,
  Server,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
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
    clearError,
  } = useConnection();

  const [showRaw, setShowRaw] = useState(false);

  const maskedToken = token ? `${token.slice(0, 6)}...${token.slice(-4)}` : 'None';

  const handleRefresh = () => {
    clearError();
    refreshCapabilities();
  };

  return (
    <div className="space-y-6 max-w-[var(--content-max-width)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] leading-[1.25]">
            Settings & Connection
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            Manage your backend connection and view platform capabilities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoadingCapabilities}
            className="btn-secondary"
          >
            <RefreshCw size={13} className={isLoadingCapabilities ? 'animate-spin' : ''} />
            <span>Refresh Status</span>
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

      <ErrorBanner error={capabilitiesError} title="Connection Error" onDismiss={clearError} />

      {/* Session Credentials Card */}
      <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Server size={16} className="text-[var(--accent)]" />
          Connection Details
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
              Server Address
            </span>
            <span className="font-mono text-[var(--text-primary)] break-all">{baseUrl}</span>
          </div>

          <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
              Access Token (Masked)
            </span>
            <span className="font-mono text-[var(--text-primary)]">{maskedToken}</span>
          </div>
        </div>

        <p className="text-[12px] text-[var(--text-muted)]">
          Your access token is kept securely in session memory and is never saved to permanent disk storage.
        </p>
      </div>

      {/* Discovered Capabilities */}
      {capabilities && (
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldCheck size={16} className="text-[var(--accent)]" />
            Platform Capabilities
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
                Automated Revocation
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    capabilities.signer_configured ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)]'
                  }`}
                />
                <span className="font-medium text-[var(--text-primary)]">
                  {capabilities.signer_configured ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] truncate">
                {capabilities.signer_configured 
                  ? 'Server is authorized to sign transactions.' 
                  : 'Signing key not loaded.'}
              </div>
            </div>

            {/* Receipt Publisher */}
            <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-1">
              <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block">
                Blockchain Publishing
              </span>
              <div className="flex items-center gap-2">
                 <span
                  className={`w-2 h-2 rounded-full ${
                    capabilities.receipt_publisher_configured ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)]'
                  }`}
                />
                <span className="font-medium text-[var(--text-primary)]">
                  {capabilities.receipt_publisher_configured ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] truncate">
                {capabilities.receipt_publisher_configured 
                  ? 'Receipts are published to the registry.' 
                  : 'Publisher key not configured.'}
              </div>
            </div>
          </div>

          {/* Collapsible Developer Details */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
            >
              {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Developer Details (Raw JSON)</span>
            </button>
            
            {showRaw && (
              <div className="mt-3 p-3 bg-[var(--bg-input)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                <CodeSnippet code={capabilities} maxHeight="max-h-48" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}