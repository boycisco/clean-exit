import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type { Agent, AuditEvent } from '../../types/api.ts';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { formatDateTime } from '../../lib/format.ts';

interface ActivityViewProps {
  onSelectAgent: (agentId: string) => void;
}

export function ActivityView({ onSelectAgent }: ActivityViewProps) {
  const [events, setEvents] = useState<Array<{ event: AuditEvent; agentName: string }>>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const fetchAllActivity = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const agents = await apiClient.listAgents({ limit: 50 });
      const aggregated: Array<{ event: AuditEvent; agentName: string }> = [];

      await Promise.all(
        agents.map(async (agent) => {
          try {
            const audits = await apiClient.getAuditTrail(agent.id, { limit: 25 });
            audits.forEach((evt) => {
              aggregated.push({ event: evt, agentName: agent.name });
            });
          } catch {
            // Ignore single agent audit failure
          }
        })
      );

      // Sort chronological newest first
      aggregated.sort(
        (a, b) => new Date(b.event.created_at).getTime() - new Date(a.event.created_at).getTime()
      );
      setEvents(aggregated);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllActivity();
  }, [fetchAllActivity]);

  return (
    <div className="space-y-6 max-w-[var(--content-max-width)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] leading-[1.25]">
            Activity
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            Recent agent and termination events.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAllActivity}
          disabled={isLoading}
          className="btn-secondary"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <ErrorBanner error={error} title="Failed to Fetch Activity" />

      {isLoading ? (
        <div className="p-12 text-center text-[13px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)]">
          Loading audit trail...
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Events will appear here when agents are registered or managed."
        />
      ) : (
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
          {events.map(({ event, agentName }) => {
            const isExpanded = !!expandedRows[event.id];
            const time = formatDateTime(event.created_at);

            return (
              <div key={event.id} className="p-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[13px]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                        {event.action}
                      </span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <button
                        type="button"
                        onClick={() => onSelectAgent(event.agent_id)}
                        className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                      >
                        {agentName}
                      </button>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-muted)]" title={time.utc}>
                      {time.relative} ({time.local})
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--bg-input)] px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                      {event.target_type}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRows((prev) => ({
                          ...prev,
                          [event.id]: !prev[event.id],
                        }))
                      }
                      className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
                    >
                      <span>{isExpanded ? 'Hide' : 'Details'}</span>
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                    <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider font-mono">
                      Event payload
                    </div>
                    <CodeSnippet code={event.payload} maxHeight="max-h-48" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
