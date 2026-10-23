import React, { useEffect, useState, useCallback } from 'react';
import { ArrowRight, Plus, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type { Agent, AuditEvent } from '../../types/api.ts';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { formatDateTime, formatAuditAction, formatTargetType } from '../../lib/format.ts';

interface OverviewDashboardProps {
  onSelectAgent: (agentId: string) => void;
  onOpenRegisterModal: () => void;
  onNavigateToAgents: () => void;
}

export function OverviewDashboard({
  onSelectAgent,
  onOpenRegisterModal,
  onNavigateToAgents,
}: OverviewDashboardProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [recentAudits, setRecentAudits] = useState<Array<{ event: AuditEvent; agentName: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const agentList = await apiClient.listAgents({ limit: 50 });
      setAgents(agentList);

      // Collect real recent audit events from registered agents (up to 5)
      const eventsAggregated: Array<{ event: AuditEvent; agentName: string }> = [];
      const agentsToCheck = agentList.slice(0, 5);
      await Promise.all(
        agentsToCheck.map(async (agent) => {
          try {
            const audits = await apiClient.getAuditTrail(agent.id, { limit: 5 });
            audits.forEach((evt) => {
              eventsAggregated.push({ event: evt, agentName: agent.name });
            });
          } catch {
            // Non-fatal if single agent audit fetch fails
          }
        })
      );

      // Sort newest first, take at most 5
      eventsAggregated.sort(
        (a, b) => new Date(b.event.created_at).getTime() - new Date(a.event.created_at).getTime()
      );
      setRecentAudits(eventsAggregated.slice(0, 5));
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived real metrics from actual API response
  const totalAgents = agents.length;
  const needsAttentionAgents = agents.filter(
    (a) => a.status === 'partial' || a.status === 'failed'
  );
  const successfulTerminations = agents.filter((a) => a.status === 'clean').length;

  return (
    <div className="space-y-7 max-w-[var(--content-max-width)]">
      {/* 1. Header: Left title/subtitle, Right primary button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] leading-[1.25]">
            Overview
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            Monitor agent permissions and termination status.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="btn-secondary"
            title="Refresh overview data"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={onOpenRegisterModal}
            className="btn-primary"
          >
            <Plus size={14} />
            <span>Register agent</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={error} title="Failed to Load Overview Data" />

      {isLoading ? (
        <div className="p-12 text-center text-[13px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
          Loading overview metrics...
        </div>
      ) : totalAgents === 0 ? (
        /* Empty overview state */
        <EmptyState
          icon={ShieldCheck}
          title="No agents registered"
          description="Register a NEAR agent to inspect its permissions and manage termination."
          action={
            <button
              type="button"
              onClick={onOpenRegisterModal}
              className="btn-primary"
            >
              <Plus size={14} />
              <span>Register agent</span>
            </button>
          }
        />
      ) : (
        <div className="space-y-7">
          {/* 2. Summary row: exactly 3 compact metrics separated by vertical dividers */}
          <div className="grid grid-cols-1 sm:grid-cols-3 border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)]">
            {/* Metric 1: Total agents */}
            <div className="p-5">
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Total agents
              </div>
              <div className="text-[25px] font-semibold text-[var(--text-primary)] font-mono tabular-nums leading-tight">
                {totalAgents}
              </div>
            </div>

            {/* Metric 2: Needs attention */}
            <div className="p-5">
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Needs attention
              </div>
              <div
                className={`text-[25px] font-semibold font-mono tabular-nums leading-tight ${
                  needsAttentionAgents.length > 0
                    ? 'text-[var(--status-warning)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {needsAttentionAgents.length}
              </div>
            </div>

            {/* Metric 3: Successful terminations */}
            <div className="p-5">
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Successful terminations
              </div>
              <div className="text-[25px] font-semibold text-[var(--status-success)] font-mono tabular-nums leading-tight">
                {successfulTerminations}
              </div>
            </div>
          </div>

          {/* 3. Needs attention section: ONLY rendered when actual data requires attention */}
          {needsAttentionAgents.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-[var(--status-warning)]" />
                <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Needs attention
                </h3>
              </div>

              <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
                {needsAttentionAgents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.id)}
                    className="p-4 flex items-center justify-between gap-4 hover:bg-[var(--bg-surface-hover)] cursor-pointer transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">
                          {agent.name}
                        </span>
                        <StatusBadge type="agent" value={agent.status} size="sm" />
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)]">
                        {agent.status === 'partial'
                          ? 'Termination completed with unresolved permissions or obligations.'
                          : 'Termination failed to establish a verified outcome; operator review required.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAgent(agent.id);
                      }}
                      className="text-[12px] font-medium text-[var(--accent)] hover:underline flex items-center gap-1 shrink-0"
                    >
                      <span>Review agent</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Recent activity section: compact list of real audit events (max 5) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Recent activity
              </h3>
            </div>

            {recentAudits.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)]">
                No recent activity recorded yet.
              </div>
            ) : (
              <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
                {recentAudits.map(({ event, agentName }) => {
                  const time = formatDateTime(event.created_at);
                  return (
                    <div
                      key={event.id}
                      onClick={() => onSelectAgent(event.agent_id)}
                      className="p-3.5 flex items-center justify-between text-[13px] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                            {formatAuditAction(event.action)}
                          </span>
                          <span className="text-[var(--text-muted)]">·</span>
                          <span className="text-[12px] text-[var(--text-secondary)]">
                            {agentName}
                          </span>
                        </div>
                        <div
                          className="text-[11px] text-[var(--text-muted)] font-mono"
                          title={time.utc}
                        >
                          {time.relative} ({time.local})
                        </div>
                      </div>

                      <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--bg-input)] px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                        {formatTargetType(event.target_type)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}