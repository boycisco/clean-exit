import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { apiClient } from '../../lib/api-client.ts';
import type {
  Authority,
  AuthorityCreateInput,
  AuthorityType,
  AuthoritySource,
} from '../../types/api.ts';

interface RegisterAuthorityModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  existingAuthorities?: Authority[];
  onAuthorityRegistered: (authority: Authority) => void;
}

export function RegisterAuthorityModal({
  isOpen,
  onClose,
  agentId,
  existingAuthorities = [],
  onAuthorityRegistered,
}: RegisterAuthorityModalProps) {
  const [type, setType] = useState<AuthorityType>('near_function_key');
  const [provider, setProvider] = useState('near');
  const [resource, setResource] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [revocable, setRevocable] = useState(true);
  const [source, setSource] = useState<AuthoritySource>('registered');
  const [scopeJson, setScopeJson] = useState('{}');
  const [metaJson, setMetaJson] = useState('{}');
  const [showJsonFields, setShowJsonFields] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedResource = resource.trim();
    if (!trimmedResource) {
      setError(new Error('Resource identifier is required.'));
      return;
    }

    let parsedScope: Record<string, unknown> = {};
    if (scopeJson.trim()) {
      try {
        parsedScope = JSON.parse(scopeJson.trim());
      } catch {
        setError(new Error('Scope must be a valid JSON object.'));
        return;
      }
    }

    let parsedMeta: Record<string, unknown> = {};
    if (metaJson.trim()) {
      try {
        parsedMeta = JSON.parse(metaJson.trim());
      } catch {
        setError(new Error('Meta must be a valid JSON object.'));
        return;
      }
    }

    const input: AuthorityCreateInput = {
      type,
      provider: provider.trim() || 'near',
      resource: trimmedResource,
      parent_id: parentId ? parentId : null,
      revocable,
      source,
      scope: parsedScope,
      meta: parsedMeta,
    };

    setIsSubmitting(true);
    try {
      const created = await apiClient.registerAuthority(agentId, input);
      setResource('');
      setParentId('');
      setScopeJson('{}');
      setMetaJson('{}');
      onAuthorityRegistered(created);
      onClose();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Register authority"
      subtitle="Attach a key, scheduled job, or capability delegation to this agent."
      maxWidth="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn-primary"
          >
            {isSubmitting ? 'Registering...' : 'Register authority'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner error={error} title="Registration failed" />

        <div className="p-3 bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/20 rounded-[var(--radius-sm)] text-[12px] text-[var(--status-warning)] leading-normal">
          <span className="font-semibold">Notice: </span>
          Newly registered authorities begin with status <code className="font-mono">unverified</code>. Registration does not confirm on-chain presence until verified.
        </div>

        {/* Authority Type */}
        <div className="space-y-1">
          <label htmlFor="auth-type" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Authority type <span className="text-[var(--status-danger)]">*</span>
          </label>
          <select
            id="auth-type"
            value={type}
            onChange={(e) => {
              const newType = e.target.value as AuthorityType;
              setType(newType);
              if (newType === 'near_function_key') {
                setProvider('near');
              }
            }}
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
          >
            <option value="near_function_key">NEAR Function Call Key (ed25519)</option>
            <option value="contract_allowance">Contract Gas / Token Allowance</option>
            <option value="scheduled_job">Scheduled Job / Cron</option>
            <option value="external_credential">External API Credential</option>
            <option value="obligation">Financial / Settlement Obligation</option>
            <option value="child_delegation">Child Agent Sub-Delegation</option>
          </select>
        </div>

        {/* Provider */}
        <div className="space-y-1">
          <label htmlFor="auth-provider" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Provider
          </label>
          <input
            id="auth-provider"
            type="text"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="e.g. near, clean, github"
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
            required
          />
        </div>

        {/* Resource */}
        <div className="space-y-1">
          <label htmlFor="auth-resource" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Resource identifier <span className="text-[var(--status-danger)]">*</span>
          </label>
          <input
            id="auth-resource"
            type="text"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            placeholder={
              type === 'near_function_key'
                ? 'ed25519:9Rzugrms7J8HHEcCP6wndF6GVAYkbtySYZiKgpisq2LU'
                : 'resource-uuid-or-path'
            }
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
            required
          />
        </div>

        {/* Parent ID for delegation tree */}
        {existingAuthorities.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="auth-parent" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
              Parent authority
            </label>
            <select
              id="auth-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
            >
              <option value="">None (Root authority)</option>
              {existingAuthorities.map((auth) => (
                <option key={auth.id} value={auth.id}>
                  {auth.type} — {auth.resource.slice(0, 24)}...
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Revocable check */}
        <div className="pt-1">
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={revocable}
              onChange={(e) => setRevocable(e.target.checked)}
              className="rounded bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--accent)]"
            />
            <span>Revocable by Clean Exit</span>
          </label>
        </div>

        {/* Optional JSON Fields Toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowJsonFields(!showJsonFields)}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors underline"
          >
            {showJsonFields ? 'Hide scope & metadata' : 'Configure scope & metadata (JSON)'}
          </button>
        </div>

        {showJsonFields && (
          <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
            <div className="space-y-1">
              <label htmlFor="scope-json" className="text-[11px] font-medium text-[var(--text-secondary)] font-mono block">
                Scope (JSON)
              </label>
              <textarea
                id="scope-json"
                rows={2}
                value={scopeJson}
                onChange={(e) => setScopeJson(e.target.value)}
                className="w-full p-2.5 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[12px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] resize-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="meta-auth-json" className="text-[11px] font-medium text-[var(--text-secondary)] font-mono block">
                Metadata (JSON)
              </label>
              <textarea
                id="meta-auth-json"
                rows={2}
                value={metaJson}
                onChange={(e) => setMetaJson(e.target.value)}
                className="w-full p-2.5 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[12px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] resize-none"
              />
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
