import React, { useState } from 'react';
import { X, KeyRound, ShieldAlert, Check, Copy, Edit2, Save } from 'lucide-react';
import type { Authority } from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { apiClient } from '../../lib/api-client.ts';
import { getAuthorityTypeMeta, formatDateTime } from '../../lib/format.ts';

interface AuthorityDrawerProps {
  authority: Authority | null;
  onClose: () => void;
  onAuthorityUpdated?: (updated: Authority) => void;
}

export function AuthorityDrawer({
  authority,
  onClose,
  onAuthorityUpdated,
}: AuthorityDrawerProps) {
  if (!authority) return null;

  const [isEditing, setIsEditing] = useState(false);
  const [revocable, setRevocable] = useState(authority.revocable);
  const [scopeText, setScopeText] = useState(JSON.stringify(authority.scope, null, 2));
  const [metaText, setMetaText] = useState(JSON.stringify(authority.meta, null, 2));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown | null>(null);

  const typeMeta = getAuthorityTypeMeta(authority.type);

  const handleSave = async () => {
    setSaveError(null);
    let parsedScope: Record<string, unknown> = {};
    let parsedMeta: Record<string, unknown> = {};

    try {
      parsedScope = JSON.parse(scopeText);
    } catch {
      setSaveError(new Error('Scope must be a valid JSON object.'));
      return;
    }

    try {
      parsedMeta = JSON.parse(metaText);
    } catch {
      setSaveError(new Error('Meta must be a valid JSON object.'));
      return;
    }

    setIsSaving(true);
    try {
      const updated = await apiClient.updateAuthority(authority.id, {
        revocable,
        scope: parsedScope,
        meta: parsedMeta,
      });
      setIsEditing(false);
      if (onAuthorityUpdated) {
        onAuthorityUpdated(updated);
      }
    } catch (err: unknown) {
      setSaveError(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-neutral-900 border-l border-neutral-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-start justify-between p-5 border-b border-neutral-800 bg-neutral-950/60 shrink-0">
        <div>
          <div className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
            {authority.provider} · {authority.source}
          </div>
          <h3 className="text-sm font-bold text-neutral-100 mt-0.5">
            {typeMeta.label}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
          aria-label="Close drawer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Drawer Body */}
      <div className="p-5 flex-1 overflow-y-auto space-y-5 text-xs text-neutral-300">
        <ErrorBanner error={saveError} title="Update Failed" />

        {/* State Badge and Actions */}
        <div className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800 rounded-lg">
          <div>
            <div className="text-[11px] text-neutral-500 mb-1">Current State</div>
            <StatusBadge type="authority" value={authority.state} />
          </div>

          {!isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
            >
              <Edit2 size={12} />
              <span>Edit Attributes</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-2 py-1 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1 text-xs text-white bg-emerald-600 hover:bg-emerald-500 rounded disabled:opacity-50"
              >
                <Save size={12} />
                <span>{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Resource Identifier */}
        <div className="space-y-1.5">
          <div className="text-neutral-400 font-medium">Resource Identifier</div>
          <CodeSnippet code={authority.resource} allowCopy maxHeight="max-h-24" />
        </div>

        {/* Attributes Grid */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-neutral-950/60 border border-neutral-800 rounded-lg">
          <div>
            <span className="text-neutral-500 block text-[11px]">Parent Authority</span>
            <span className="font-mono text-neutral-300 truncate block">
              {authority.parent_id ? `${authority.parent_id.slice(0, 8)}...` : 'None (Root)'}
            </span>
          </div>

          <div>
            <span className="text-neutral-500 block text-[11px]">Revocable Hint</span>
            {isEditing ? (
              <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={revocable}
                  onChange={(e) => setRevocable(e.target.checked)}
                  className="rounded bg-neutral-950 border-neutral-800 text-emerald-500"
                />
                <span className="text-neutral-200">Revocable</span>
              </label>
            ) : (
              <span className={`font-mono ${authority.revocable ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {authority.revocable ? 'Yes (Supported)' : 'No'}
              </span>
            )}
          </div>

          <div>
            <span className="text-neutral-500 block text-[11px]">Source</span>
            <span className="font-mono text-neutral-300 capitalize">
              {authority.source}
            </span>
          </div>

          <div>
            <span className="text-neutral-500 block text-[11px]">Created At</span>
            <span className="font-mono text-neutral-400 text-[11px]">
              {formatDateTime(authority.created_at).local}
            </span>
          </div>
        </div>

        {/* Scope Field */}
        <div className="space-y-1.5">
          <div className="text-neutral-400 font-medium">Delegation Scope</div>
          {isEditing ? (
            <textarea
              rows={4}
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded font-mono text-xs text-neutral-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
          ) : (
            <CodeSnippet code={authority.scope} maxHeight="max-h-36" />
          )}
        </div>

        {/* Metadata Field */}
        <div className="space-y-1.5">
          <div className="text-neutral-400 font-medium">Custom Metadata</div>
          {isEditing ? (
            <textarea
              rows={4}
              value={metaText}
              onChange={(e) => setMetaText(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded font-mono text-xs text-neutral-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
          ) : (
            <CodeSnippet code={authority.meta} maxHeight="max-h-36" />
          )}
        </div>

        {/* Immutable rules notice */}
        <div className="p-3 bg-neutral-950 border border-neutral-800 rounded text-[11px] text-neutral-500 leading-relaxed">
          <span className="text-neutral-400 font-semibold">Immutable Fields: </span>
          Authority type and parent hierarchy are immutable after registration to preserve the cryptographic audit trail. Re-parenting requires deletion and re-registration.
        </div>
      </div>
    </div>
  );
}
