import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Info,
  Clock,
  Radio,
  FileCode,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client.ts';
import { useConnection } from '../../context/ConnectionContext.tsx';
import type { Receipt, ReceiptVerifyResponse } from '../../types/api.ts';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { CodeSnippet } from '../../components/common/CodeSnippet.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { formatDateTime } from '../../lib/format.ts';

interface ReceiptViewerProps {
  receiptId?: string;
  agentId?: string;
}

export function ReceiptViewer({ receiptId, agentId }: ReceiptViewerProps) {
  const { capabilities } = useConnection();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [verifyResult, setVerifyResult] = useState<ReceiptVerifyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const fetchReceipt = useCallback(async () => {
    if (!receiptId && !agentId) return;

    setIsLoading(true);
    setError(null);
    try {
      let data: Receipt | null = null;
      if (receiptId) {
        data = await apiClient.getReceipt(receiptId);
      } else if (agentId) {
        data = await apiClient.getAgentReceipt(agentId);
      }
      setReceipt(data);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [receiptId, agentId]);

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  const handleVerify = async () => {
    if (!receipt) return;
    setIsVerifying(true);
    try {
      const res = await apiClient.verifyReceipt(receipt.id);
      setVerifyResult(res);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // ignore
    }
  };

  const publisherConfigured = capabilities?.receipt_publisher_configured ?? false;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-neutral-100">
              Receipt & Verification Proof
            </h3>
            {receipt && (
              <span className="font-mono text-xs text-neutral-400">
                {receipt.id.slice(0, 8)}...
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Cryptographic proof and termination receipt inspection for autonomous agents.
          </p>
        </div>

        {receipt && (
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded transition-colors shadow-xs"
          >
            <ShieldCheck size={14} />
            <span>{isVerifying ? 'Verifying...' : 'Verify Cryptographic Integrity'}</span>
          </button>
        )}
      </div>

      <ErrorBanner error={error} title="Receipt Query Failed" />

      {/* Priority 4 Notice — Accurate Capability Reflection */}
      <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-lg space-y-2 text-xs">
        <div className="flex items-center gap-2 text-neutral-200 font-semibold">
          <Info size={15} className="text-neutral-400" />
          <span>Receipt Capability Status: Priority 4c Pending</span>
        </div>
        <p className="text-neutral-400 leading-relaxed text-[11px]">
          According to the Clean Exit specification and API contract, the on-chain receipt publisher contract is not yet active on this deployment.
          When an agent finishes termination, an off-chain receipt with a SHA-256 canonical hash is stored in the database.
          Clean Exit does not fabricate fake on-chain transaction hashes or public verification claims.
        </p>
        <div className="flex items-center gap-4 pt-1 font-mono text-[11px]">
          <span className="text-neutral-500">
            On-Chain Publisher:{' '}
            <strong className={publisherConfigured ? 'text-emerald-400' : 'text-neutral-400'}>
              {publisherConfigured ? 'Configured' : 'Not Configured (Expected)'}
            </strong>
          </span>
          <span className="text-neutral-500">
            Contract Status:{' '}
            <strong className={capabilities?.contract_configured ? 'text-emerald-400' : 'text-neutral-400'}>
              {capabilities?.contract_configured ? 'Active' : 'Unset'}
            </strong>
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-lg">
          Querying receipt record...
        </div>
      ) : !receipt ? (
        <div className="p-8 text-center bg-neutral-900/30 border border-neutral-800 rounded-lg space-y-2">
          <FileCheck2 size={24} className="mx-auto text-neutral-600" />
          <h4 className="text-sm font-semibold text-neutral-300">
            No Finalized Receipt Available
          </h4>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            {receiptId
              ? `Receipt ${receiptId} returned 404 (Priority 4c endpoint pending or receipt not found).`
              : 'Execute an agent termination to finalize and generate an auditable termination receipt.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Receipt Status & Summary */}
          <div className="p-5 bg-neutral-900/80 border border-neutral-800 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-neutral-500 uppercase font-mono tracking-wider">
                  Authoritative Outcome
                </span>
                <div className="mt-1">
                  <StatusBadge type="receipt" value={receipt.result} />
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-neutral-500 uppercase font-mono tracking-wider block">
                  Publication Status
                </span>
                <span className="font-mono text-xs text-neutral-400 capitalize">
                  {receipt.verification_status.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Receipt Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded text-xs">
              <div>
                <span className="text-neutral-500 text-[11px] block">Agent ID</span>
                <span className="font-mono text-neutral-300 truncate block">
                  {receipt.agent_id.slice(0, 8)}...
                </span>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px] block">NEAR Account</span>
                <span className="font-mono text-neutral-300 truncate block">
                  {receipt.agent_near_account || 'None'}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px] block">Network</span>
                <span className="font-mono uppercase text-neutral-300">
                  {receipt.network}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px] block">Schema Version</span>
                <span className="font-mono text-neutral-300">
                  v{receipt.schema_version}
                </span>
              </div>
            </div>

            {/* SHA-256 Payload Hash */}
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 font-medium">Canonical Payload Hash (SHA-256)</span>
                <button
                  type="button"
                  onClick={() => copyHash(receipt.payload_hash)}
                  className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white"
                >
                  {copiedHash ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copy Hash</span>
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-[11px] text-neutral-200 bg-neutral-950 p-2.5 rounded border border-neutral-800 break-all select-all">
                {receipt.payload_hash}
              </div>
            </div>

            {/* On-chain commitment status */}
            <div className="p-3 bg-neutral-950/60 border border-neutral-800 rounded text-xs space-y-1">
              <div className="text-neutral-400 font-medium">On-Chain Publication Commitment</div>
              {receipt.onchain_tx_hash ? (
                <div className="font-mono text-[11px] text-emerald-400 break-all">
                  Tx: {receipt.onchain_tx_hash}
                </div>
              ) : (
                <div className="text-[11px] text-neutral-500">
                  Off-chain storage only. On-chain registry publication is not configured on this deployment.
                </div>
              )}
            </div>

            {/* Canonical Payload Viewer */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-300">
                  Canonical Receipt Payload
                </span>
                <span className="font-mono text-[11px] text-neutral-500">
                  Immutable Record
                </span>
              </div>
              <CodeSnippet code={receipt.payload} maxHeight="max-h-80" />
            </div>
          </div>

          {/* Verification Results Panel if verified */}
          {verifyResult && (
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-lg text-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {verifyResult.verified ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  ) : (
                    <XCircle size={16} className="text-rose-400" />
                  )}
                  <span className="font-bold text-neutral-100">
                    {verifyResult.verified ? 'Cryptographic Integrity Verified' : 'Verification Mismatch'}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-neutral-400">
                  Status: {verifyResult.onchain_status}
                </span>
              </div>

              <div className="p-3 bg-neutral-950 rounded border border-neutral-800 text-[11px] text-neutral-400 space-y-1">
                <p>
                  <strong>Verification Semantics: </strong>
                  <code>verified: true</code> confirms that the off-chain receipt payload hash matches the cryptographic commitment.
                  It does not mean all real-world permissions were destroyed outside Clean Exit.
                </p>
                {verifyResult.notes && verifyResult.notes.length > 0 && (
                  <ul className="list-disc list-inside text-neutral-500 pt-1">
                    {verifyResult.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
