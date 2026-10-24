import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal.tsx';
import { TriStateBadge } from '../../components/common/TriStateBadge.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { apiClient } from '../../lib/api-client.ts';
import type { VerifyResponse, AuthorityState } from '../../types/api.ts';
import { formatDateTime, getAuthorityStateMeta } from '../../lib/format.ts';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  nearAccount: string | null;
  onVerificationComplete?: () => void;
}

export function VerificationModal({
  isOpen,
  onClose,
  agentId,
  agentName,
  nearAccount,
  onVerificationComplete,
}: VerificationModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<unknown | null>(null);

  const runVerification = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const resp = await apiClient.verifyAuthorities(agentId);
      setResult(resp);
      if (onVerificationComplete) {
        onVerificationComplete();
      }
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsRunning(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Verify Authority On-Chain"
      subtitle={`Read-only verification against the NEAR blockchain for agent "${agentName}".`}
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-[11px] text-neutral-400">
            Read-only check. Submits no transactions. Does not consume gas.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={runVerification}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded transition-colors shadow-xs"
            >
              <RefreshCw size={13} className={isRunning ? 'animate-spin' : ''} />
              <span>{result ? 'Re-Run Verification' : 'Start Verification'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} title="Verification Request Failed" />

        {!result && !isRunning && !error && (
          <div className="p-4 bg-neutral-950/60 border border-neutral-800 rounded-lg space-y-3 text-xs text-neutral-300">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <Search size={16} className="text-emerald-400" />
              <span>Target Account & Scope</span>
            </div>
            <div className="space-y-1">
              <div className="text-neutral-400">NEAR Account:</div>
              <div className="font-mono text-neutral-200 bg-neutral-900 px-2 py-1 rounded border border-neutral-800">
                {nearAccount || 'No account attached — verification will check local/registered state'}
              </div>
            </div>
            <p className="text-neutral-400 leading-relaxed">
              Clean Exit will check the NEAR blockchain for permissions associated with this account.
              State will only be updated for confirmed checks.
            </p>
          </div>
        )}

        {isRunning && (
          <div className="p-8 text-center space-y-3">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="text-sm font-medium text-neutral-200">
              Checking the NEAR blockchain...
            </div>
            <p className="text-xs text-neutral-400">
              Inspecting on-chain public keys and matching against registered inventory.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Summary strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-lg text-xs">
              <div>
                <span className="text-neutral-500 block text-[11px]">Account Existence</span>
                <span className={`font-mono font-semibold ${result.account_exists ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {result.account_exists ? 'Exists on NEAR' : 'Not Found'}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[11px]">Total Observed Keys</span>
                <span className="font-mono font-semibold text-neutral-200 tabular-nums">
                  {result.total_observed_keys}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[11px]">Checked At</span>
                <span className="font-mono text-[11px] text-neutral-400" title={formatDateTime(result.checked_at).utc}>
                  {formatDateTime(result.checked_at).local}
                </span>
              </div>
            </div>

            {/* Inconclusive warning if error returned */}
            {result.error && (
              <div className="p-3 bg-amber-950/40 border border-amber-900/60 rounded text-xs text-amber-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span>Inconclusive Verification Result</span>
                </div>
                <p className="text-amber-300/90 leading-relaxed">{result.error}</p>
                <p className="text-[11px] text-amber-400/80">
                  Statuses have NOT been modified because the blockchain check was inconclusive.
                </p>
              </div>
            )}

            {/* Verified items */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-neutral-200 flex items-center justify-between">
                <span>Verified Authorities ({result.verified.length})</span>
                <span className="text-[11px] text-neutral-500">Matches registered inventory</span>
              </h4>

              {result.verified.length === 0 ? (
                <div className="p-3 bg-neutral-950 rounded border border-neutral-800 text-xs text-neutral-500 text-center">
                  No registered authorities were verified in this pass.
                </div>
              ) : (
                <div className="space-y-2">
                  {result.verified.map((v) => (
                    <div
                      key={v.authority_id}
                      className="p-3 bg-neutral-950/80 border border-neutral-800 rounded text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-[11px] text-neutral-300 truncate max-w-sm">
                          {v.resource}
                        </div>
                        <TriStateBadge onChain={v.on_chain} size="sm" />
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-neutral-400 pt-1 border-t border-neutral-800/60">
                        <div className="flex items-center gap-1.5">
                          <span>Transition:</span>
                          <span className="font-mono text-neutral-400">
                            {getAuthorityStateMeta(v.previous_state as AuthorityState).label}
                          </span>
                          <ArrowRight size={10} className="text-neutral-600" />
                          <span className="font-mono font-medium text-emerald-400">
                            {getAuthorityStateMeta(v.new_state as AuthorityState).label}
                          </span>
                        </div>
                        <span className="text-neutral-600">·</span>
                        <div className="text-neutral-400">{v.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Skipped items */}
            {result.skipped.length > 0 && (
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-semibold text-neutral-400 flex items-center justify-between">
                  <span>Skipped or Unsupported ({result.skipped.length})</span>
                  <span className="text-[11px] text-neutral-500 font-mono">Could not verify</span>
                </h4>
                <div className="space-y-2">
                  {result.skipped.map((s) => (
                    <div
                      key={s.authority_id}
                      className="p-2.5 bg-neutral-950/50 border border-neutral-800/80 rounded text-xs flex items-center justify-between gap-2"
                    >
                      <div className="truncate max-w-xs">
                        <div className="font-mono text-[11px] text-neutral-300 truncate">{s.resource}</div>
                        <div className="text-[10px] text-neutral-500">{s.detail}</div>
                      </div>
                      <TriStateBadge onChain={null} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}