import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type { Agent, AgentStatus } from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';

interface AgentsListProps {
  onSelectAgent: (agentId: string) => void;
  onOpenRegisterModal: () => void;
}

const PAGE_SIZE = 20;

export function AgentsList({ onSelectAgent, onOpenRegisterModal }: AgentsListProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const fetchAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await apiClient.listAgents({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset,
      });
      setAgents(list);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, offset]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filteredAgents = agents.filter((agent) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = agent.name.toLowerCase().includes(query);
    const accountMatch = agent.near_account?.toLowerCase().includes(query) ?? false;
    return nameMatch || accountMatch;
  });

  const statuses: Array<{ value: AgentStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'termination_requested', label: 'Termination requested' },
    { value: 'terminating', label: 'Terminating' },
    { value: 'clean', label: 'Clean' },
    { value: 'partial', label: 'Partial' },
    { value: 'failed', label: 'Failed' },
  ];

  return (
    <div className="space-y-6 max-w-[var(--content-max-width)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] leading-[1.25]">
            Agents
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
            Manage registered agents and their permissions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchAgents}
            disabled={isLoading}
            className="btn-secondary"
            title="Refresh agents"
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

      <ErrorBanner error={error} title="Failed to Fetch Agents" />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by name or NEAR account..."
            className="w-full h-10 pl-9 pr-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as AgentStatus | 'all');
            setOffset(0);
          }}
          className="h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
        >
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Agents Table */}
      {isLoading ? (
        <div className="p-12 text-center text-[13px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)]">
          Loading agents...
        </div>
      ) : filteredAgents.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={searchQuery || statusFilter !== 'all' ? 'No matching agents found' : 'No agents registered'}
          description={
            searchQuery || statusFilter !== 'all'
              ? 'Try modifying your search query or lifecycle status filter.'
              : 'Register a NEAR agent to inspect its permissions and manage termination.'
          }
          action={
            !searchQuery && statusFilter === 'all' ? (
              <button
                type="button"
                onClick={onOpenRegisterModal}
                className="btn-primary"
              >
                <Plus size={14} />
                <span>Register agent</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr
                  style={{ height: '36px' }}
                  className="border-b border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-muted)] text-[12px] font-medium select-none"
                >
                  <th style={{ width: '32%', padding: '0 12px' }}>Agent</th>
                  <th style={{ width: '25%', padding: '0 12px' }}>NEAR account</th>
                  <th style={{ width: '12%', padding: '0 12px' }}>Environment</th>
                  <th style={{ width: '15%', padding: '0 12px' }}>Status</th>
                  <th style={{ width: '16%', padding: '0 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => {
                  const envLabel =
                    agent.environment.charAt(0).toUpperCase() + agent.environment.slice(1);

                  return (
                    <tr
                      key={agent.id}
                      onClick={() => onSelectAgent(agent.id)}
                      style={{ height: '60px' }}
                      className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-surface-hover)] cursor-pointer transition-colors"
                    >
                      {/* Agent (32%) */}
                      <td style={{ padding: '0 12px' }}>
                        <div className="font-medium text-[var(--text-primary)]">
                          {agent.name}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)] truncate max-w-xs mt-0.5">
                          {agent.id}
                        </div>
                      </td>

                      {/* NEAR account (25%) */}
                      <td style={{ padding: '0 12px' }}>
                        {agent.near_account ? (
                          <span className="font-mono text-[12px] text-[var(--text-primary)]">
                            {agent.near_account}
                          </span>
                        ) : (
                          <span className="text-[12px] text-[var(--text-muted)]">
                            Not provided
                          </span>
                        )}
                      </td>

                      {/* Environment (12%) - Plain text */}
                      <td style={{ padding: '0 12px' }} className="text-[var(--text-secondary)] text-[13px]">
                        {envLabel}
                      </td>

                      {/* Status (15%) - Dot + text */}
                      <td style={{ padding: '0 12px' }}>
                        <StatusBadge type="agent" value={agent.status} size="sm" />
                      </td>

                      {/* Actions (16%) */}
                      <td style={{ padding: '0 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAgent(agent.id);
                          }}
                          className="text-[12px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                        >
                          <span>Open</span>
                          <ArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination row */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] text-[12px] text-[var(--text-muted)]">
            <div>
              Showing <span className="font-mono text-[var(--text-primary)]">{offset + 1}</span>–
              <span className="font-mono text-[var(--text-primary)]">
                {offset + filteredAgents.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || isLoading}
                className="h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <ChevronLeft size={12} />
                <span>Previous</span>
              </button>
              <button
                type="button"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={agents.length < PAGE_SIZE || isLoading}
                className="h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <span>Next</span>
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}