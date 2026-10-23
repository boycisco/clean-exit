import React, { useState, useEffect, useCallback } from 'react';
import {
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  KeyRound,
  FileCode,
  Calendar,
  Lock,
  GitFork,
  ArrowRight,
  Info,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import type {
  Authority,
  AuthorityNode,
  AuthorityGraphResponse,
  AuthorityType,
} from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { RegisterAuthorityModal } from './RegisterAuthorityModal.tsx';
import { VerificationModal } from './VerificationModal.tsx';
import { AuthorityDrawer } from './AuthorityDrawer.tsx';
import { getAuthorityTypeMeta, truncateString } from '../../lib/format.ts';

interface AuthorityGraphProps {
  agentId: string;
  agentName: string;
  nearAccount: string | null;
}

export function AuthorityGraph({ agentId, agentName, nearAccount }: AuthorityGraphProps) {
  const [graphData, setGraphData] = useState<AuthorityGraphResponse | null>(null);
  const [flatAuthorities, setFlatAuthorities] = useState<Authority[]>([]);
  const [selectedAuthority, setSelectedAuthority] = useState<Authority | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);

  const fetchGraph = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await apiClient.getAuthorityGraph(agentId);
      setGraphData(resp);

      // Collect flat list for parent selection
      const list: Authority[] = [];
      const traverse = (node: AuthorityNode) => {
        list.push(node.authority);
        node.children.forEach(traverse);
      };
      resp.roots.forEach(traverse);
      resp.orphaned.forEach((o) => list.push(o));
      setFlatAuthorities(list);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getAuthorityIcon = (type: AuthorityType) => {
    switch (type) {
      case 'near_function_key':
        return <KeyRound size={14} className="text-emerald-400" />;
      case 'contract_allowance':
        return <FileCode size={14} className="text-sky-400" />;
      case 'scheduled_job':
        return <Calendar size={14} className="text-amber-400" />;
      case 'external_credential':
        return <Lock size={14} className="text-purple-400" />;
      case 'child_delegation':
        return <GitFork size={14} className="text-teal-400" />;
      case 'obligation':
        return <AlertTriangle size={14} className="text-rose-400" />;
      default:
        return <Network size={14} className="text-neutral-400" />;
    }
  };

  const renderNode = (node: AuthorityNode, depth = 0) => {
    const { authority, children } = node;
    const isCollapsed = collapsedNodes[authority.id];
    const hasChildren = children.length > 0;
    const isSelected = selectedAuthority?.id === authority.id;

    return (
      <div key={authority.id} className="relative">
        <div
          onClick={() => setSelectedAuthority(authority)}
          className={`flex items-center justify-between gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
            isSelected
              ? 'bg-neutral-800 border-emerald-500/60 shadow-xs'
              : 'bg-neutral-900/60 hover:bg-neutral-800/60 border-neutral-800'
          }`}
          style={{ marginLeft: `${depth * 24}px` }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(authority.id);
                }}
                className="p-0.5 text-neutral-400 hover:text-white rounded"
                aria-label={isCollapsed ? 'Expand child permissions' : 'Collapse child permissions'}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-700" />
              </span>
            )}

            <div className="shrink-0">{getAuthorityIcon(authority.type)}</div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-neutral-200">
                  {getAuthorityTypeMeta(authority.type).label}
                </span>
                <span className="text-neutral-600">·</span>
                <span className="font-mono text-neutral-400 truncate max-w-xs sm:max-w-md">
                  {truncateString(authority.resource, 36)}
                </span>
              </div>
              <div className="text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5">
                <span>Provider: {authority.provider}</span>
                <span>·</span>
                <span>Origin: {authority.source}</span>
                <span>·</span>
                <span>{authority.revocable ? 'Revocable' : 'Irrevocable'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge type="authority" value={authority.state} size="sm" />
          </div>
        </div>

        {/* Child branches */}
        {hasChildren && !isCollapsed && (
          <div className="mt-2 space-y-2 border-l border-neutral-800 ml-4 pl-2">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const totalCount =
    (graphData?.roots?.length || 0) + (graphData?.orphaned?.length || 0);

  return (
    <div className="space-y-5">
      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <h3 className="text-base font-bold text-neutral-100">Permission Graph</h3>
          <p className="text-xs text-neutral-400">
            Hierarchical map of keys, child agents, and operational permissions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchGraph}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setIsVerifyModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded transition-colors"
          >
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Verify Blockchain</span>
          </button>
          <button
            type="button"
            onClick={() => setIsRegisterModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded transition-colors shadow-xs"
          >
            <Plus size={14} />
            <span>Register Permission</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={error} title="Failed to Load Permission Graph" />

      {/* Scope Disclaimer Banner */}
      <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg text-xs text-neutral-400 flex items-start gap-2.5">
        <Info size={15} className="text-neutral-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          This graph displays permissions registered in Clean Exit or discovered during scanning.
          An empty tree indicates no permissions have been registered yet; it does not constitute proof that the agent possesses no on-chain keys.
        </p>
      </div>

      {/* Graph Content */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
          Loading permission hierarchy...
        </div>
      ) : !graphData || (graphData.roots.length === 0 && graphData.orphaned.length === 0) ? (
        <EmptyState
          icon={Network}
          title="No permissions registered yet"
          description="This does not mean the agent has no permissions. Register known permissions or verify supported on-chain state to establish an inventory."
          warningNote="Clean Exit never assumes absence without proof. Register access keys, scheduled jobs, or external credentials to plan a clean exit."
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsRegisterModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded transition-colors"
              >
                <Plus size={14} />
                <span>Register Permission</span>
              </button>
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
              >
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Run Verification</span>
              </button>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Orphaned Permissions Warning Section */}
          {graphData.orphaned.length > 0 && (
            <div className="p-4 bg-amber-950/20 border border-amber-900/50 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                <AlertTriangle size={15} className="text-amber-400" />
                <span>Orphaned Permissions ({graphData.orphaned.length})</span>
              </div>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                These permissions reference a missing parent that no longer exists in the database.
                Clean Exit isolates them here rather than hiding malformed hierarchy.
              </p>

              <div className="space-y-2">
                {graphData.orphaned.map((orphan) => (
                  <div
                    key={orphan.id}
                    onClick={() => setSelectedAuthority(orphan)}
                    className="p-3 bg-neutral-950 border border-amber-900/40 rounded flex items-center justify-between text-xs cursor-pointer hover:border-amber-700 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {getAuthorityIcon(orphan.type)}
                      <div>
                        <div className="font-semibold text-neutral-200">
                          {getAuthorityTypeMeta(orphan.type).label}
                        </div>
                        <div className="font-mono text-[11px] text-neutral-400">
                          {truncateString(orphan.resource, 32)} (missing parent)
                        </div>
                      </div>
                    </div>
                    <StatusBadge type="authority" value={orphan.state} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Root Permissions Tree */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-neutral-400 flex items-center justify-between px-1">
              <span>Permission Hierarchy ({graphData.roots.length} root chains)</span>
              <span className="text-[11px] text-neutral-500 font-mono">
                Execution order (children before parents)
              </span>
            </div>

            <div className="space-y-2">
              {graphData.roots.map((rootNode) => renderNode(rootNode, 0))}
            </div>
          </div>
        </div>
      )}

      {/* Modals & Drawer */}
      <RegisterAuthorityModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        agentId={agentId}
        existingAuthorities={flatAuthorities}
        onAuthorityRegistered={() => {
          fetchGraph();
        }}
      />

      <VerificationModal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        agentId={agentId}
        agentName={agentName}
        nearAccount={nearAccount}
        onVerificationComplete={() => {
          fetchGraph();
        }}
      />

      <AuthorityDrawer
        authority={selectedAuthority}
        onClose={() => setSelectedAuthority(null)}
        onAuthorityUpdated={(updated) => {
          setSelectedAuthority(updated);
          fetchGraph();
        }}
      />
    </div>
  );
}