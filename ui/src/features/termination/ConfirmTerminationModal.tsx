import React, { useState } from 'react';
import { PowerOff } from 'lucide-react';
import { Modal } from '../../components/common/Modal.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { apiClient } from '../../lib/api-client.ts';
import { useConnection } from '../../context/ConnectionContext.tsx';
import type { TerminationJob } from '../../types/api.ts';

interface ConfirmTerminationModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  supportedCount?: number;
  unsupportedCount?: number;
  manualCount?: number;
  onJobStarted: (job: TerminationJob) => void;
}

export function ConfirmTerminationModal({
  isOpen,
  onClose,
  agentId,
  agentName,
  supportedCount = 0,
  unsupportedCount = 0,
  manualCount = 0,
  onJobStarted,
}: ConfirmTerminationModalProps) {
  const { capabilities } = useConnection();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const generateIdempotencyKey = () => {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);

    const idempotencyKey = generateIdempotencyKey();

    try {
      const job = await apiClient.createTerminationJob(agentId, {
        reason: reason.trim() || undefined,
        idempotency_key: idempotencyKey,
      });

      onJobStarted(job);
      onClose();
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const signerReady = capabilities?.signer_configured ?? false;

  // Translate raw signer_reason
  const getSignerReason = () => {
    const reasonStr = capabilities?.signer_reason || '';
    if (reasonStr === 'signer_unavailable') return 'Signing key not loaded';
    if (reasonStr === 'signer_invalid') return 'Signing key is invalid';
    if (reasonStr === 'mainnet_signing_forbidden_in_non_production') return 'Mainnet signing disabled';
    return reasonStr || 'Backend key not configured';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Terminate ${agentName}?`}
      maxWidth="terminate"
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
            onClick={handleConfirm}
            disabled={!signerReady || isSubmitting}
            className="btn-danger"
          >
            <PowerOff size={13} />
            <span>{isSubmitting ? 'Submitting...' : 'Confirm termination'}</span>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} title="Termination request failed" />

        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          This will attempt to revoke supported permissions associated with this agent. 
          Some permissions may require manual action or remain outside the registered inventory.
        </p>

        {/* Action Category Summary: omit empty categories */}
        <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-2 text-[12px]">
          <div className="font-medium text-[var(--text-primary)]">
            Plan Summary
          </div>

          <div className="space-y-1.5 text-[var(--text-secondary)]">
            {supportedCount > 0 && (
              <div className="flex items-center justify-between">
                <span>Automatic revocations:</span>
                <span className="font-mono text-[var(--status-success)] font-medium">
                  {supportedCount}
                </span>
              </div>
            )}
            {manualCount > 0 && (
              <div className="flex items-center justify-between">
                <span>Manual actions required:</span>
                <span className="font-mono text-[var(--status-warning)] font-medium">
                  {manualCount}
                </span>
              </div>
            )}
            {unsupportedCount > 0 && (
              <div className="flex items-center justify-between">
                <span>Unsupported permissions:</span>
                <span className="font-mono text-[var(--text-muted)] font-medium">
                  {unsupportedCount}
                </span>
              </div>
            )}
            {supportedCount === 0 && manualCount === 0 && unsupportedCount === 0 && (
              <div className="text-[12px] text-[var(--text-muted)] italic">
                No registered permissions found. A clean termination receipt will be generated.
              </div>
            )}
          </div>
        </div>

        {/* Reason Input */}
        <div className="space-y-1">
          <label htmlFor="term-reason" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Reason (Optional)
          </label>
          <input
            id="term-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Task completed, rotation, decommissioning"
            maxLength={2048}
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
          />
        </div>

        {!signerReady && (
          <div className="text-[12px] text-[var(--status-warning)] bg-[var(--status-warning-bg)] p-2.5 rounded-[var(--radius-sm)] border border-[var(--status-warning)]/20 leading-normal">
            Signing unavailable: {getSignerReason()}. Automatic revocation cannot proceed.
          </div>
        )}
      </div>
    </Modal>
  );
}