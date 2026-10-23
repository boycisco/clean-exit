import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PowerOff,
  RefreshCw,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck2,
  ArrowRight,
  ShieldCheck,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api-client.ts';
import type { TerminationJob, JobPhase, JobStatus } from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import {
  getJobPhaseMeta,
  getJobStatusMeta,
  formatDateTime,
} from '../../lib/format.ts';

interface TerminationExecutionProps {
  initialJob: TerminationJob;
  agentName: string;
  onViewReceipt?: (receiptId: string) => void;
  onJobFinished?: (job: TerminationJob) => void;
  onBackToAgent?: () => void;
}

const PHASES_ORDERED: JobPhase[] = [
  'validate',
  'inventory',
  'plan',
  'revoke',
  'resolve_obligations',
  'verify',
  'finalize',
  'complete',
];

export function TerminationExecution({
  initialJob,
  agentName,
  onViewReceipt,
  onJobFinished,
  onBackToAgent,
}: TerminationExecutionProps) {
  const [job, setJob] = useState<TerminationJob>(initialJob);
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRetryConfirmOpen, setIsRetryConfirmOpen] = useState(false);
  const [retryError, setRetryError] = useState<unknown | null>(null);

  const pollIntervalRef = useRef<number | null>(null);

  const fetchJobStatus = useCallback(async () => {
    try {
      const updated = await apiClient.getTerminationJob(job.id);
      setJob(updated);

      const isTerminal =
        updated.status === 'succeeded' ||
        updated.status === 'partial' ||
        updated.status === 'failed' ||
        updated.status === 'cancelled';

      if (isTerminal) {
        setIsPolling(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (onJobFinished) {
          onJobFinished(updated);
        }
      }
    } catch (err: unknown) {
      setError(err);
    }
  }, [job.id, onJobFinished]);

  useEffect(() => {
    const isTerminal =
      job.status === 'succeeded' ||
      job.status === 'partial' ||
      job.status === 'failed' ||
      job.status === 'cancelled';

    if (!isTerminal) {
      pollIntervalRef.current = window.setInterval(fetchJobStatus, 1500);
    } else {
      setIsPolling(false);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchJobStatus, job.status]);

  const handleRetrySubmit = async () => {
    setRetryError(null);
    setIsRetrying(true);
    try {
      const retriedJob = await apiClient.retryTerminationJob(job.id);
      setJob(retriedJob);
      setIsPolling(true);
      setIsRetryConfirmOpen(false);
    } catch (err: unknown) {
      setRetryError(err);
    } finally {
      setIsRetrying(false);
    }
  };

  const currentPhaseIndex = PHASES_ORDERED.indexOf(job.phase);
  const canRetry = job.status === 'failed' || job.status === 'partial';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Execution Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-neutral-100">
              Termination Execution
            </h3>
            <span className="font-mono text-xs text-neutral-400">
              Job ID: {job.id.slice(0, 8)}...
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Agent: <span className="text-neutral-200 font-semibold">{agentName}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onBackToAgent && (
            <button
              type="button"
              onClick={onBackToAgent}
              className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Back to Agent
            </button>
          )}

          {canRetry && (
            <button
              type="button"
              onClick={() => setIsRetryConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-white bg-amber-950/60 hover:bg-amber-900 border border-amber-800/80 rounded transition-colors shadow-xs"
            >
              <RotateCw size={13} />
              <span>Retry Incomplete Job</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchJobStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded transition-colors"
          >
            <RefreshCw size={13} className={isPolling ? 'animate-spin' : ''} />
            <span>{isPolling ? 'Polling Status...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={error} title="Polling Error" />
      <ErrorBanner error={retryError} title="Retry Request Rejected" />

      {/* Progress Phase Tracker */}
      <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-lg space-y-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Current Phase:</span>
            <span className="font-semibold text-neutral-100 uppercase tracking-wider font-mono">
              {getJobPhaseMeta(job.phase).label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Job Status:</span>
            <StatusBadge type="job" value={job.status} size="sm" />
          </div>
        </div>

        {/* Phase Timeline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2">
          {PHASES_ORDERED.map((p, idx) => {
            const isCompleted = idx < currentPhaseIndex || job.status === 'succeeded';
            const isCurrent = idx === currentPhaseIndex && job.status !== 'succeeded';
            const isPending = idx > currentPhaseIndex && job.status !== 'succeeded';

            let stateStyle = 'bg-neutral-950 border-neutral-800 text-neutral-500';
            if (isCompleted) {
              stateStyle = 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300';
            } else if (isCurrent) {
              stateStyle =
                job.status === 'failed'
                  ? 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                  : 'bg-sky-950/40 border-sky-800/80 text-sky-300';
            }

            return (
              <div
                key={p}
                className={`p-2.5 rounded border text-center text-xs transition-colors ${stateStyle}`}
              >
                <div className="font-mono text-[10px] text-neutral-500 mb-0.5">
                  0{idx + 1}
                </div>
                <div className="font-semibold capitalize truncate">{p.replace('_', ' ')}</div>
              </div>
            );
          })}
        </div>

        <div className="text-xs text-neutral-400 leading-relaxed bg-neutral-950/60 p-3 rounded border border-neutral-800/80">
          <span className="text-neutral-200 font-medium">Phase Description: </span>
          {getJobPhaseMeta(job.phase).description}
        </div>
      </div>

      {/* Terminal Outcome Box */}
      {!isPolling && (
        <div
          className={`p-5 rounded-lg border text-xs space-y-3 ${
            job.status === 'succeeded'
              ? 'bg-emerald-950/20 border-emerald-900/40'
              : job.status === 'partial'
              ? 'bg-amber-950/20 border-amber-900/40'
              : 'bg-rose-950/20 border-rose-900/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {job.status === 'succeeded' ? (
                <CheckCircle2 size={18} className="text-emerald-400" />
              ) : job.status === 'partial' ? (
                <AlertTriangle size={18} className="text-amber-400" />
              ) : (
                <XCircle size={18} className="text-rose-400" />
              )}
              <h4 className="font-bold text-sm text-neutral-100">
                {job.status === 'succeeded'
                  ? 'Termination Completed Successfully'
                  : job.status === 'partial'
                  ? 'Partial Termination (Unresolved Items)'
                  : 'Termination Execution Failed'}
              </h4>
            </div>

            {job.receipt_id && onViewReceipt && (
              <button
                type="button"
                onClick={() => onViewReceipt(job.receipt_id!)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 rounded transition-colors shadow-xs"
              >
                <FileCheck2 size={13} className="text-emerald-400" />
                <span>View Receipt ({job.receipt_id.slice(0, 8)}...)</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>

          <div className="text-neutral-300 leading-relaxed text-[11px] space-y-1">
            <p>
              <strong>Receipt Truth Guarantee: </strong>
              The final receipt outcome reflects the verified state of all authorities registered in Clean Exit.
              Clean Exit does not claim that permissions outside this registry have been revoked.
            </p>
            {job.error && (
              <p className="text-rose-300 font-mono bg-rose-950/60 p-2 rounded border border-rose-900/60 mt-2">
                Error Detail: {job.error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Execution Diagnostics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-neutral-900/60 border border-neutral-800 rounded-lg text-xs">
        <div>
          <span className="text-neutral-500 text-[11px] block">Requested Time</span>
          <span className="font-mono text-neutral-300 text-[11px]" title={formatDateTime(job.requested_at).utc}>
            {formatDateTime(job.requested_at).local}
          </span>
        </div>
        <div>
          <span className="text-neutral-500 text-[11px] block">Started Time</span>
          <span className="font-mono text-neutral-300 text-[11px]" title={formatDateTime(job.started_at).utc}>
            {formatDateTime(job.started_at).local}
          </span>
        </div>
        <div>
          <span className="text-neutral-500 text-[11px] block">Completed Time</span>
          <span className="font-mono text-neutral-300 text-[11px]" title={formatDateTime(job.completed_at).utc}>
            {formatDateTime(job.completed_at).local}
          </span>
        </div>
        <div>
          <span className="text-neutral-500 text-[11px] block">Retry Count</span>
          <span className="font-mono font-semibold text-neutral-200 tabular-nums">
            {job.retry_count}
          </span>
        </div>
      </div>

      {/* Retry Confirmation Modal */}
      <Modal
        isOpen={isRetryConfirmOpen}
        onClose={() => setIsRetryConfirmOpen(false)}
        title="Retry Termination Job"
        subtitle={`Resume execution for job ${job.id}.`}
        maxWidth="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsRetryConfirmOpen(false)}
              className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRetrySubmit}
              disabled={isRetrying}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded"
            >
              <RotateCw size={13} className={isRetrying ? 'animate-spin' : ''} />
              <span>{isRetrying ? 'Resuming Job...' : 'Confirm Retry'}</span>
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
          <p>
            Clean Exit preserves completed revocation attempts and will resume only eligible failed or unresolved authorities.
          </p>
          <div className="p-3 bg-neutral-950 border border-neutral-800 rounded font-mono text-[11px] text-neutral-400">
            • Resets retry count to 0<br />
            • Skips already revoked keys to avoid redundant on-chain transactions<br />
            • Re-evaluates post-order queue
          </div>
        </div>
      </Modal>
    </div>
  );
}
