import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  PowerOff,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus,
  GitGraph,
  List,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import { useConnection } from '../../context/ConnectionContext.tsx';
import type {
  Agent,
  Authority,
  AuthorityNode,
  AuthorityGraphResponse,
  TerminationPlan,
  TerminationJob,
  AuditEvent,
  VerifyResponse,
} from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { TriStateBadge } from '../../components/common/TriStateBadge.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { RegisterAuthorityModal } from '../authorities/RegisterAuthorityModal.tsx';
import { ConfirmTerminationModal } from '../termination/ConfirmTerminationModal.tsx';
import {
  formatDateTime,
  getAuthorityTypeMeta,
  getJobPhaseMeta,
  formatAuditAction,
  formatTargetType,
  getTerminationActionMeta,
} from '../../lib/format.ts';

interface AgentDetailsProps {
  agentId: string;
  onBack: () => void;
  onNavigateToActivity?: () => void;
}

type TabType = 'overview' | 'authority' | 'termination' | 'activity';

export function AgentDetails({ agentId, onBack, onNavigateToActivity }: AgentDetailsProps) {
  const { capabilities } = useConnection();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  // Authority data
  const [authorityGraph, setAuthorityGraph] = useState<AuthorityGraphResponse | null>(null);
  const [flatAuthorities, setFlatAuthorities] = useState<Authority[]>([]);
  const [isGraphView, setIsGraphView] = useState(false);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string | null>(null);
  const [expandedAuthorityDetails, setExpandedAuthorityDetails] = useState<Record<string, boolean>>({});

  // Termination plan & jobs
  const [terminationPlan, setTerminationPlan] = useState<TerminationPlan | null>(null);
  const [activeJob, setActiveJob] = useState<TerminationJob | null>(null);
  const [jobHistory, setJobHistory] = useState<TerminationJob[]>([]);
  const [isPollingJob, setIsPollingJob] = useState(false);

  // Agent Audit events
  const [agentAudits, setAgentAudits] = useState<AuditEvent[]>([]);
  const [expandedAuditRows, setExpandedAuditRows] = useState<Record<number, boolean>>({});

  // Modals
  const [isRegisterAuthorityOpen, setIsRegisterAuthorityOpen] = useState(false);
  const [isConfirmTerminationOpen, setIsConfirmTerminationOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);

  // Technical details disclosure on Overview tab
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // 1. Fetch Agent Core Info
  const fetchAgent = useCallback(async () => {
    try {
      const data = await apiClient.getAgent(agentId);
      setAgent(data);
    } catch (err: unknown) {
      setError(err);
    }
  }, [agentId]);

  // 2. Fetch Authorities Graph & flat list
  const fetchAuthorities = useCallback(async () => {
    try {
      const resp = await apiClient.getAuthorityGraph(agentId);
      setAuthorityGraph(resp);

      const list: Authority[] = [];
      const traverse = (node: AuthorityNode) => {
        list.push(node.authority);
        node.children.forEach(traverse);
      };
      resp.roots.forEach(traverse);
      resp.orphaned.forEach((o) => list.push(o));
      setFlatAuthorities(list);
    } catch {
      // Non-fatal if authorities fail
    }
  }, [agentId]);

  // 3. Fetch Termination Plan
  const fetchPlan = useCallback(async () => {
    try {
      const plan = await apiClient.getTerminationPlan(agentId);
      setTerminationPlan(plan);
    } catch {
      // Non-fatal
    }
  }, [agentId]);

  // 4. Fetch Termination Jobs & latest job
  const fetchJobs = useCallback(async () => {
    try {
      const jobs = await apiClient.listTerminationJobs(agentId);
      setJobHistory(jobs);
      if (jobs.length > 0) {
        const latest = jobs[0];
        if (latest.status === 'pending' || latest.status === 'running') {
          setActiveJob(latest);
          setIsPollingJob(true);
        } else if (!activeJob) {
          setActiveJob(latest);
        }
      }
    } catch {
      // Non-fatal
    }
  }, [agentId, activeJob]);

  // 5. Fetch Agent Audits
  const fetchAudits = useCallback(async () => {
    try {
      const audits = await apiClient.getAuditTrail(agentId, { limit: 50 });
      setAgentAudits(audits);
    } catch {
      // Non-fatal
    }
  }, [agentId]);

  // Master initial loader
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await fetchAgent();
      await Promise.all([fetchAuthorities(), fetchPlan(), fetchJobs(), fetchAudits()]);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAgent, fetchAuthorities, fetchPlan, fetchJobs, fetchAudits]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Job Polling
  useEffect(() => {
    if (!activeJob || !isPollingJob) return;

    const interval = setInterval(async () => {
      try {
        const updated = await apiClient.getTerminationJob(activeJob.id);
        setActiveJob(updated);
        const isTerminal =
          updated.status === 'succeeded' ||
          updated.status === 'partial' ||
          updated.status === 'failed' ||
          updated.status === 'cancelled';
        if (isTerminal) {
          setIsPollingJob(false);
          fetchAgent();
          fetchPlan();
          fetchAuthorities();
          fetchAudits();
        }
      } catch {
        setIsPollingJob(false);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJob, isPollingJob, fetchAgent, fetchPlan, fetchAuthorities, fetchAudits]);

  // Verify authorities action
  const handleVerifyAuthorities = async () => {
    setIsVerifying(true);
    try {
      const res = await apiClient.verifyAuthorities(agentId);
      setVerifyResult(res);
      await fetchAuthorities();
      await fetchAgent();
    } catch (err) {
      setError(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const signerReady = capabilities?.signer_configured ?? false;

  if (isLoading && !agent) {
    return (
      <div className="p-12 text-center text-[13px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)]">
        Loading agent workspace...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-4 max-w-[var(--content-max-width)]">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={14} />
          <span>Back to agents</span>
        </button>
        <ErrorBanner error={error || new Error('Agent not found or inaccessible.')} title="Agent Unavailable" />
      </div>
    );
  }

  const envLabel =
    agent.environment.charAt(0).toUpperCase() + agent.environment.slice(1);
  const totalAuthCount = flatAuthorities.length;

  return (
    <div className="space-y-6 max-w-[var(--content-max-width)]">
      {/* 1. Agent Header: Breadcrumb + Header row */}
      <div className="space-y-2">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <button
            type="button"
            onClick={onBack}
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Agents
          </button>
          <span>/</span>
          <span className="text-[var(--text-secondary)] font-medium truncate max-w-sm">
            {agent.name}
          </span>
        </div>

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">
                {agent.name}
              </h1>
              <StatusBadge type="agent" value={agent.status} size="sm" />
            </div>

            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>{envLabel}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="font-mono text-[var(--text-primary)]">
                {agent.near_account || 'No NEAR account'}
              </span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                ID: {agent.id.slice(0, 8)}...
              </span>
            </div>
          </div>

          {/* Right Action Area */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleVerifyAuthorities}
              disabled={isVerifying}
              className="btn-secondary"
            >
              <ShieldCheck size={14} />
              <span>{isVerifying ? 'Verifying...' : 'Verify authority'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsConfirmTerminationOpen(true)}
              disabled={!signerReady}
              title={
                !signerReady
                  ? `Signer unavailable: ${capabilities?.signer_reason || 'Backend key not configured'}`
                  : 'Terminate agent permissions'
              }
              className="btn-danger"
            >
              <PowerOff size={13} />
              <span>Terminate agent</span>
            </button>
          </div>
        </div>
      </div>

      <ErrorBanner error={error} title="Workspace Error" />

      {/* Verification Result Banner if just run */}
      {verifyResult && (
        <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[12px] space-y-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                verifyResult.account_exists ? 'bg-[var(--status-success)]' : 'bg-[var(--status-danger)]'
              }`}
            />
            <span className="text-[var(--text-primary)] font-medium">
              Verification check: {verifyResult.account_exists ? 'Account verified on NEAR' : 'Account absent'}
            </span>
            <span className="text-[var(--text-muted)] font-mono">
              ({verifyResult.total_observed_keys} keys observed)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setVerifyResult(null)}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Horizontal Tab Bar (Height: 42px) */}
      <div className="border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-6" style={{ height: '42px' }}>
          {[
            { id: 'overview' as TabType, label: 'Overview' },
            { id: 'authority' as TabType, label: 'Authority' },
            { id: 'termination' as TabType, label: 'Termination' },
            { id: 'activity' as TabType, label: 'Activity' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-full flex items-center px-1 text-[13px] font-medium transition-colors relative cursor-pointer ${
                  isActive
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent)]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Tab Contents */}

      {/* TAB: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Two-column layout on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Main Column: Status and Concise Authority Summary */}
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Permission summary
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Agent status</span>
                  <StatusBadge type="agent" value={agent.status} size="sm" />
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Registered permissions</span>
                  <span className="font-mono text-[var(--text-primary)] font-medium tabular-nums">
                    {totalAuthCount}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Verification state</span>
                  <span className="text-[var(--text-primary)]">
                    {flatAuthorities.some((a) => a.state === 'active')
                      ? 'Verified on-chain'
                      : flatAuthorities.some((a) => a.state === 'unverified')
                      ? 'Unverified'
                      : 'Not established'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[var(--text-secondary)]">Environment</span>
                  <span className="text-[var(--text-primary)]">{envLabel}</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('authority')}
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                >
                  <span>Manage permissions</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* Secondary Column: Termination Readiness & Latest Event */}
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Termination readiness
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Signer readiness</span>
                  <span className={signerReady ? 'text-[var(--status-success)] font-medium' : 'text-[var(--status-warning)] font-medium'}>
                    {signerReady ? 'Configured' : 'Signer unavailable'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Automatic revocations</span>
                  <span className="font-mono text-[var(--text-primary)] font-medium tabular-nums">
                    {terminationPlan ? terminationPlan.supported_count : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)]">Manual / Unsupported</span>
                  <span className="font-mono text-[var(--text-muted)] font-medium tabular-nums">
                    {terminationPlan
                      ? terminationPlan.manual_count + terminationPlan.unsupported_count
                      : '—'}
                  </span>
                </div>

                <div className="py-1.5">
                  <span className="text-[var(--text-secondary)] block text-[11px] mb-1">Latest activity</span>
                  {agentAudits.length > 0 ? (
                    <div className="text-[12px] text-[var(--text-primary)] font-mono">
                      {formatAuditAction(agentAudits[0].action)} · {formatDateTime(agentAudits[0].created_at).relative}
                    </div>
                  ) : (
                    <div className="text-[12px] text-[var(--text-muted)] italic">
                      No events recorded
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('termination')}
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                >
                  <span>Review termination plan</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* Expandable Technical Details */}
          <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-4">
            <button
              type="button"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              className="w-full flex items-center justify-between text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <span>Technical details</span>
              {showTechnicalDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showTechnicalDetails && (
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] space-y-3">
                <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider font-mono">
                  Agent Metadata
                </div>
                <CodeSnippet code={agent.meta} maxHeight="max-h-48" />

                <div className="grid grid-cols-2 gap-3 text-[11px] font-mono text-[var(--text-muted)] pt-2">
                  <div>Created: {formatDateTime(agent.created_at).utc}</div>
                  <div>Last active: {formatDateTime(agent.last_activity_at).utc}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: AUTHORITY */}
      {activeTab === 'authority' && (
        <div className="space-y-4">
          {/* Sub-header with Register action and Graph View toggle */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
            <div className="text-[13px] text-[var(--text-secondary)]">
              {totalAuthCount} registered {totalAuthCount === 1 ? 'permission' : 'permissions'}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsGraphView(!isGraphView)}
                className="h-8 px-2.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors"
              >
                {isGraphView ? <List size={13} /> : <GitGraph size={13} />}
                <span>{isGraphView ? 'List view' : 'Graph view'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsRegisterAuthorityOpen(true)}
                className="btn-primary"
                style={{ height: '32px' }}
              >
                <Plus size={13} />
                <span>Add permission</span>
              </button>
            </div>
          </div>

          {/* Orphaned Authority Warning Banner (only if API returns orphaned authorities) */}
          {authorityGraph && authorityGraph.orphaned.length > 0 && (
            <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 text-[12px] text-[var(--status-warning)] space-y-1">
              <div className="font-medium flex items-center gap-1.5">
                <AlertTriangle size={14} />
                <span>Orphaned permissions detected ({authorityGraph.orphaned.length})</span>
              </div>
              <p className="text-[11px] opacity-90 leading-normal">
                These permissions reference a missing parent in the hierarchy. They are listed below for reconciliation.
              </p>
            </div>
          )}

          {/* VIEW 1: Clean List of Registered Authorities (DEFAULT) */}
          {!isGraphView && (
            <>
              {flatAuthorities.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] space-y-2">
                  <p>No permissions registered yet.</p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    This does not mean the agent has no permissions. Register known keys or verify supported on-chain state.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsRegisterAuthorityOpen(true)}
                    className="btn-secondary mt-3"
                  >
                    <Plus size={13} />
                    <span>Register permission</span>
                  </button>
                </div>
              ) : (
                <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
                  {flatAuthorities.map((auth) => {
                    const isExpanded = !!expandedAuthorityDetails[auth.id];
                    const meta = getAuthorityTypeMeta(auth.type);

                    return (
                      <div key={auth.id} className="p-4 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[13px]">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[var(--text-primary)]">
                                {meta.label}
                              </span>
                              <span className="text-[var(--text-muted)] font-mono text-[11px]">
                                ({auth.provider})
                              </span>
                            </div>
                            <div className="font-mono text-[12px] text-[var(--text-secondary)] truncate max-w-lg">
                              {auth.resource}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <StatusBadge type="authority" value={auth.state} size="sm" />
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAuthorityDetails((prev) => ({
                                  ...prev,
                                  [auth.id]: !prev[auth.id],
                                }))
                              }
                              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
                            >
                              <span>{isExpanded ? 'Less' : 'Details'}</span>
                              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          </div>
                        </div>

                        {/* Details disclosure */}
                        {isExpanded && (
                          <div className="pt-2 text-[12px] text-[var(--text-secondary)] border-t border-[var(--border-subtle)] space-y-2">
                            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                              <div>Origin: {auth.source}</div>
                              <div>Revocable: {auth.revocable ? 'Yes' : 'No'}</div>
                              <div>Parent ID: {auth.parent_id || 'None (Root)'}</div>
                              <div>Created: {formatDateTime(auth.created_at).local}</div>
                            </div>
                            {auth.scope && Object.keys(auth.scope).length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[11px] text-[var(--text-muted)] font-mono">Scope:</span>
                                <CodeSnippet code={auth.scope} maxHeight="max-h-32" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* VIEW 2: Minimalist Graph View */}
          {isGraphView && (
            <div className="p-6 rounded-[var(--radius-md)] bg-[var(--bg-app)] border border-[var(--border-subtle)] space-y-4">
              <div className="flex items-center justify-between text-[12px] text-[var(--text-muted)] pb-2 border-b border-[var(--border-subtle)]">
                <span>Permission hierarchy</span>
                {/* Legend */}
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)]" /> Active / Selected
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--status-warning)]" /> Unverified / Manual
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--status-danger)]" /> Failed
                  </span>
                </div>
              </div>

              {authorityGraph && authorityGraph.roots.length > 0 ? (
                <div className="space-y-3">
                  {authorityGraph.roots.map((rootNode) => (
                    <div
                      key={rootNode.authority.id}
                      className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2"
                    >
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-[var(--text-primary)]">
                          {getAuthorityTypeMeta(rootNode.authority.type).label}
                        </span>
                        <StatusBadge type="authority" value={rootNode.authority.state} size="sm" />
                      </div>
                      <div className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
                        {rootNode.authority.resource}
                      </div>

                      {/* Children */}
                      {rootNode.children.length > 0 && (
                        <div className="pl-4 mt-2 border-l border-[var(--border-subtle)] space-y-2">
                          {rootNode.children.map((child) => (
                            <div
                              key={child.authority.id}
                              className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[12px] space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {getAuthorityTypeMeta(child.authority.type).label}
                                </span>
                                <StatusBadge type="authority" value={child.authority.state} size="sm" />
                              </div>
                              <div className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                                {child.authority.resource}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[var(--text-muted)] text-center py-6">
                  No permission nodes to graph.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: TERMINATION */}
      {activeTab === 'termination' && (
        <div className="space-y-6">
          {/* Active Job Progress View (if execution is running or finished) */}
          {activeJob ? (
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                    Termination job status
                  </h3>
                  <div className="font-mono text-[11px] text-[var(--text-muted)] mt-0.5">
                    Job ID: {activeJob.id}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge type="job" value={activeJob.status} size="sm" />
                  {isPollingJob && (
                    <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                      <RefreshCw size={11} className="animate-spin" />
                      <span>Polling...</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Steps Based on Real Phases */}
              <div className="space-y-2 text-[12px]">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono">
                  <span>Current phase: {getJobPhaseMeta(activeJob.phase).label}</span>
                  <span>Retries: {activeJob.retry_count}</span>
                </div>

                <div className="p-3 bg-[var(--bg-input)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] font-mono text-[12px] text-[var(--text-secondary)]">
                  {getJobPhaseMeta(activeJob.phase).description}
                </div>
              </div>

              {/* Terminal Outcome */}
              {!isPollingJob && (
                <div
                  className={`p-4 rounded-[var(--radius-sm)] border text-[13px] space-y-1.5 ${
                    activeJob.status === 'succeeded'
                      ? 'bg-[var(--status-success-bg)] border-[var(--status-success)]/30 text-[var(--status-success)]'
                      : activeJob.status === 'partial'
                      ? 'bg-[var(--status-warning-bg)] border-[var(--status-warning)]/30 text-[var(--status-warning)]'
                      : 'bg-[var(--status-danger-bg)] border-[var(--status-danger)]/30 text-[var(--status-danger)]'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    {activeJob.status === 'succeeded' ? (
                      <CheckCircle2 size={16} />
                    ) : activeJob.status === 'partial' ? (
                      <AlertTriangle size={16} />
                    ) : (
                      <XCircle size={16} />
                    )}
                    <span>
                      {activeJob.status === 'succeeded'
                        ? 'Clean termination complete'
                        : activeJob.status === 'partial'
                        ? 'Partial termination completed'
                        : 'Termination execution failed'}
                    </span>
                  </div>
                  <p className="text-[12px] opacity-90 leading-normal">
                    {activeJob.reason || 'All registered permissions in scope were evaluated.'}
                  </p>
                  {activeJob.receipt_id && (
                    <div className="pt-1 text-[11px] font-mono text-[var(--text-primary)]">
                      Receipt ID: {activeJob.receipt_id}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Pre-Execution Plan & Ordered Steps */}
          {terminationPlan && (
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                    Termination plan
                  </h3>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Pre-calculated sequence (child permissions revoked before parents).
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsConfirmTerminationOpen(true)}
                  disabled={!signerReady}
                  className="btn-danger"
                >
                  <PowerOff size={13} />
                  <span>Terminate agent</span>
                </button>
              </div>

              {/* Plan metrics */}
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <div className="p-3 bg-[var(--bg-input)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)] block text-[11px]">Automatic revocations</span>
                  <span className="font-mono text-[18px] font-semibold text-[var(--status-success)]">
                    {terminationPlan.supported_count}
                  </span>
                </div>
                <div className="p-3 bg-[var(--bg-input)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)] block text-[11px]">Manual actions required</span>
                  <span className="font-mono text-[18px] font-semibold text-[var(--status-warning)]">
                    {terminationPlan.manual_count}
                  </span>
                </div>
                <div className="p-3 bg-[var(--bg-input)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)] block text-[11px]">Unsupported permissions</span>
                  <span className="font-mono text-[18px] font-semibold text-[var(--text-muted)]">
                    {terminationPlan.unsupported_count}
                  </span>
                </div>
              </div>

              {/* Ordered Steps List */}
              <div className="space-y-2">
                <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Ordered steps ({terminationPlan.steps.length})
                </div>

                {terminationPlan.steps.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-muted)] py-4 text-center">
                    No permissions in scope for this agent.
                  </div>
                ) : (
                  <div className="border border-[var(--border-subtle)] rounded-[var(--radius-sm)] divide-y divide-[var(--border-subtle)] bg-[var(--bg-app)]">
                    {terminationPlan.steps.map((step) => {
                      const actionMeta = getTerminationActionMeta(step.action);
                      const typeMeta = getAuthorityTypeMeta(step.type);
                      const supportLabel = step.support === 'supported' ? 'Automatic' : step.support === 'partial' ? 'Partial' : 'Unsupported';

                      return (
                        <div key={step.order} className="p-3 flex items-center justify-between text-[12px] gap-3">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[11px] text-[var(--text-muted)] w-5 text-right">
                              {step.order}.
                            </span>
                            <div>
                              <span className="font-medium text-[var(--text-primary)]">
                                {actionMeta.label}
                              </span>
                              <span className="font-mono text-[11px] text-[var(--text-secondary)] ml-2">
                                {typeMeta.label}
                              </span>
                            </div>
                          </div>

                          <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--bg-input)] px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
                            {supportLabel}
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
      )}

      {/* TAB: ACTIVITY */}
      {activeTab === 'activity' && (
        <div className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Agent activity trail
            </h3>
            <button
              type="button"
              onClick={fetchAudits}
              className="btn-secondary"
              style={{ height: '30px' }}
            >
              <RefreshCw size={12} />
              <span>Refresh</span>
            </button>
          </div>

          {agentAudits.length === 0 ? (
            <div className="text-[13px] text-[var(--text-muted)] text-center py-8">
              No audit records for this agent yet.
            </div>
          ) : (
            <div className="border border-[var(--border-subtle)] rounded-[var(--radius-sm)] divide-y divide-[var(--border-subtle)] bg-[var(--bg-app)]">
              {agentAudits.map((event) => {
                const isExpanded = !!expandedAuditRows[event.id];
                const time = formatDateTime(event.created_at);

                return (
                  <div key={event.id} className="p-3 text-[13px] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                          {formatAuditAction(event.action)}
                        </span>
                        <span className="text-[var(--text-muted)] font-mono text-[11px]">
                          ({formatTargetType(event.target_type)})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[var(--text-muted)] font-mono" title={time.utc}>
                          {time.relative}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedAuditRows((prev) => ({
                              ...prev,
                              [event.id]: !prev[event.id],
                            }))
                          }
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        <CodeSnippet code={event.payload} maxHeight="max-h-40" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <RegisterAuthorityModal
        isOpen={isRegisterAuthorityOpen}
        onClose={() => setIsRegisterAuthorityOpen(false)}
        agentId={agent.id}
        existingAuthorities={flatAuthorities}
        onAuthorityRegistered={() => {
          fetchAuthorities();
          fetchPlan();
          fetchAgent();
        }}
      />

      <ConfirmTerminationModal
        isOpen={isConfirmTerminationOpen}
        onClose={() => setIsConfirmTerminationOpen(false)}
        agentId={agent.id}
        agentName={agent.name}
        supportedCount={terminationPlan?.supported_count}
        unsupportedCount={terminationPlan?.unsupported_count}
        manualCount={terminationPlan?.manual_count}
        onJobStarted={(newJob) => {
          setActiveJob(newJob);
          setIsPollingJob(true);
          setActiveTab('termination');
        }}
      />
    </div>
  );
}