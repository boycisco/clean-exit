import React, { useState, useEffect, useCallback } from 'react';
import {
  PowerOff,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  ListOrdered,
  Info,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import { useConnection } from '../../context/ConnectionContext.tsx';
import type { TerminationPlan, TerminationStep } from '../../types/api.ts';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { getTerminationActionMeta, truncateString } from '../../lib/format.ts';

interface TerminationPlanViewProps {
  agentId: string;
  agentName: string;
  nearAccount: string | null;
  agentStatus: string;
  onRequestTermination: () => void;
}

export function TerminationPlanView({
  agentId,
  agentName,
  nearAccount,
  agentStatus,
  onRequestTermination,
}: TerminationPlanViewProps) {
  const { capabilities } = useConnection();
  const [plan, setPlan] = useState<TerminationPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const fetchPlan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getTerminationPlan(agentId);
      setPlan(data);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const signerAvailable = capabilities?.signer_configured ?? false;
  const isAgentTerminal = agentStatus === 'clean' || agentStatus === 'failed';

  return (
    <div className="space-y-5">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-neutral-100">Termination Plan</h3>
          <p className="text-xs text-neutral-400">
            Pre-flight dry-run of destruction and revocation steps (post-order dependency traversal).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchPlan}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>Recalculate Plan</span>
          </button>

          <button
            type="button"
            onClick={onRequestTermination}
            disabled={!signerAvailable || isAgentTerminal || isLoading}
            title={
              !signerAvailable
                ? `Signing key unavailable: ${capabilities?.signer_reason || 'signer not loaded'}`
                : isAgentTerminal
                ? `Agent is in terminal state (${agentStatus}). Further termination is disabled.`
                : 'Initiate termination workflow'
            }
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors shadow-xs"
          >
            <PowerOff size={13} />
            <span>Initiate Termination...</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={error} title="Failed to Generate Termination Plan" />

      {/* Signer Disabled Alert if applicable */}
      {!signerAvailable && (
        <div className="p-3.5 bg-amber-950/30 border border-amber-900/50 rounded-lg text-xs text-amber-200 flex items-start gap-2.5">
          <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-100">
              Signer Not Configured — Destructive Revocation Disabled
            </div>
            <p className="text-amber-300/90 leading-relaxed">
              Reason: <code className="font-mono">{capabilities?.signer_reason || 'signer_unavailable'}</code>.
              The termination plan is inspectable, but Clean Exit cannot submit NEAR key deletion transactions until an operator loads credentials.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
          Analyzing authority tree and calculating post-order execution plan...
        </div>
      ) : !plan ? (
        <EmptyState
          icon={ListOrdered}
          title="Plan unavailable"
          description="Could not generate termination plan for this agent."
        />
      ) : (
        <div className="space-y-5">
          {/* Metrics Overview Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg">
              <span className="text-[11px] text-neutral-500 block">Total Authorities</span>
              <span className="text-xl font-bold font-mono tabular-nums text-neutral-100">
                {plan.total_authorities}
              </span>
            </div>

            <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg">
              <span className="text-[11px] text-neutral-500 block">Supported Actions</span>
              <span className="text-xl font-bold font-mono tabular-nums text-emerald-400">
                {plan.supported_count}
              </span>
            </div>

            <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg">
              <span className="text-[11px] text-neutral-500 block">Unsupported Actions</span>
              <span className="text-xl font-bold font-mono tabular-nums text-neutral-400">
                {plan.unsupported_count}
              </span>
            </div>

            <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg">
              <span className="text-[11px] text-neutral-500 block">Manual Operator Tasks</span>
              <span className="text-xl font-bold font-mono tabular-nums text-amber-400">
                {plan.manual_count}
              </span>
            </div>
          </div>

          {/* Plan Notes from Backend */}
          {plan.notes && plan.notes.length > 0 && (
            <div className="p-3.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs space-y-1.5">
              <div className="font-semibold text-neutral-300 flex items-center gap-1.5">
                <Info size={14} className="text-neutral-400" />
                <span>Backend Plan Notes</span>
              </div>
              <ul className="text-neutral-400 space-y-1 list-disc list-inside">
                {plan.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Post-Order Steps Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-semibold text-neutral-200">
                Ordered Execution Sequence ({plan.steps.length} steps)
              </h4>
              <span className="text-[11px] text-neutral-500">
                Sub-delegations executed before parent authorities
              </span>
            </div>

            {plan.steps.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
                No authorities in scope. A termination request will produce a clean or empty receipt.
              </div>
            ) : (
              <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/40">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-800 bg-neutral-950/60 text-neutral-400 font-medium">
                        <th className="py-2.5 px-3 w-12 text-center">#</th>
                        <th className="py-2.5 px-4">Action</th>
                        <th className="py-2.5 px-4">Type & Resource</th>
                        <th className="py-2.5 px-4">Support</th>
                        <th className="py-2.5 px-4">Authorization</th>
                        <th className="py-2.5 px-4">Verification Procedure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60 font-normal">
                      {plan.steps.map((step) => {
                        const actionMeta = getTerminationActionMeta(step.action);
                        return (
                          <tr key={step.order} className="hover:bg-neutral-800/30">
                            <td className="py-3 px-3 text-center font-mono text-neutral-500 tabular-nums">
                              {step.order}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-neutral-200">
                                {actionMeta.label}
                              </div>
                              <div className="text-[10px] text-neutral-500">
                                {actionMeta.description}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-mono text-neutral-300">
                                {step.type}
                              </div>
                              <div className="font-mono text-[11px] text-neutral-500 truncate max-w-xs">
                                {truncateString(step.resource, 28)}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                                  step.support === 'supported'
                                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                                    : step.support === 'partial'
                                    ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                                    : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                                }`}
                              >
                                {step.support}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-neutral-400 font-mono text-[11px]">
                              {step.required_authorization}
                            </td>
                            <td className="py-3 px-4 text-neutral-400 text-[11px]">
                              {step.verification}
                              {step.risk && (
                                <div className="text-amber-400 text-[10px] mt-0.5">
                                  Risk: {step.risk}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
