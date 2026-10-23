import React, { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, ArrowRight, FileCheck2, Bot } from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type { TerminationJob } from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { formatDateTime } from '../../lib/format.ts';

interface TerminationHistoryProps {
  agentId: string;
  onSelectJob: (job: TerminationJob) => void;
  onViewReceipt?: (receiptId: string) => void;
}

export function TerminationHistory({
  agentId,
  onSelectJob,
  onViewReceipt,
}: TerminationHistoryProps) {
  const [jobs, setJobs] = useState<TerminationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.listTerminationJobs(agentId);
      setJobs(data);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
        <div>
          <h4 className="text-sm font-bold text-neutral-200">
            Termination History
          </h4>
          <p className="text-xs text-neutral-400">
            All past and in-progress termination jobs recorded for this agent.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchJobs}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 hover:text-white bg-neutral-900 border border-neutral-800 rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <ErrorBanner error={error} title="Failed to Fetch Job History" />

      {isLoading ? (
        <div className="p-8 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
          Loading termination jobs...
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No termination jobs recorded"
          description="This agent has not had any termination jobs requested yet."
        />
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/40">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/60 text-neutral-400 font-medium">
                  <th className="py-2.5 px-4">Job ID</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4">Phase</th>
                  <th className="py-2.5 px-4">Job Status</th>
                  <th className="py-2.5 px-4">Requested</th>
                  <th className="py-2.5 px-4">Receipt</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => onSelectJob(job)}
                    className="hover:bg-neutral-800/30 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-neutral-200">
                      {job.id.slice(0, 8)}...
                    </td>
                    <td className="py-3 px-4 text-neutral-300 truncate max-w-xs">
                      {job.reason || <span className="text-neutral-500 italic">None specified</span>}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] uppercase text-neutral-400">
                      {job.phase}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge type="job" value={job.status} size="sm" />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-neutral-400" title={formatDateTime(job.requested_at).utc}>
                      {formatDateTime(job.requested_at).local}
                    </td>
                    <td className="py-3 px-4">
                      {job.receipt_id ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onViewReceipt) onViewReceipt(job.receipt_id!);
                          }}
                          className="font-mono text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
                        >
                          <FileCheck2 size={12} />
                          <span>{job.receipt_id.slice(0, 8)}...</span>
                        </button>
                      ) : (
                        <span className="text-neutral-500 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectJob(job);
                        }}
                        className="px-2.5 py-1 text-xs text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
