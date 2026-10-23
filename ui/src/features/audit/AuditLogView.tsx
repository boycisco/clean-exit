import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollText,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type { AuditEvent } from '../../types/api.ts';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { formatDateTime, formatAuditAction, formatTargetType } from '../../lib/format.ts';

interface AuditLogViewProps {
  agentId: string;
  agentName?: string;
}

const PAGE_SIZE = 25;

export function AuditLogView({ agentId, agentName }: AuditLogViewProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const fetchAudit = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAuditTrail(agentId, {
        limit: PAGE_SIZE,
        offset,
      });
      setEvents(data);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, offset]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const toggleRow = (id: number) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-neutral-100">Immutable Audit Trail</h3>
            {agentName && (
              <span className="text-xs text-neutral-400 font-normal">
                for {agentName}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Cryptographically chronological event stream recorded server-side. Append-only.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAudit}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          <span>Refresh Trail</span>
        </button>
      </div>

      <ErrorBanner error={error} title="Failed to Fetch Audit Trail" />

      {isLoading ? (
        <div className="p-12 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
          Loading audit events...
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit events recorded"
          description="Actions such as termination requests, retries, and receipt creation will append audit records here."
        />
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/40">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/60 text-neutral-400 font-medium">
                  <th className="py-3 px-4 w-12 text-center">ID</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Timestamp (Local / UTC)</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {events.map((evt) => {
                  const isExpanded = expandedRow === evt.id;
                  const time = formatDateTime(evt.created_at);

                  return (
                    <React.Fragment key={evt.id}>
                      <tr
                        onClick={() => toggleRow(evt.id)}
                        className="hover:bg-neutral-800/30 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-neutral-500 text-center tabular-nums">
                          {evt.id}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-semibold text-neutral-200 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                            {formatAuditAction(evt.action)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-neutral-300">
                            {formatTargetType(evt.target_type || '')}
                          </div>
                          <div className="font-mono text-[11px] text-neutral-500 truncate max-w-xs">
                            {evt.target_id}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-neutral-400">
                          {evt.actor_owner_id ? (
                            <span title={evt.actor_owner_id}>
                              {evt.actor_owner_id.slice(0, 8)}...
                            </span>
                          ) : (
                            <span className="text-neutral-500 italic">System / Worker</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px]">
                          <div className="text-neutral-300">{time.local}</div>
                          <div className="text-neutral-500 text-[10px]" title="UTC timestamp">
                            {time.utc}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRow(evt.id);
                            }}
                            className="p-1 text-neutral-400 hover:text-white rounded"
                            aria-label={isExpanded ? 'Collapse event payload' : 'Expand event payload'}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-neutral-950/80">
                          <td colSpan={6} className="p-4 border-t border-neutral-800/80">
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider font-mono">
                                Event Details
                              </div>
                              <CodeSnippet code={evt.payload} maxHeight="max-h-60" />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-800/80 bg-neutral-950/40 text-xs text-neutral-400">
            <div>
              Showing <span className="font-mono text-neutral-200">{offset + 1}</span>–
              <span className="font-mono text-neutral-200">
                {offset + events.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || isLoading}
                className="flex items-center gap-1 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={13} />
                <span>Previous</span>
              </button>
              <button
                type="button"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={events.length < PAGE_SIZE || isLoading}
                className="flex items-center gap-1 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}