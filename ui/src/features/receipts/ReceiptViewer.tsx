import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ShieldCheck,
  Info,
  Upload,
  ChevronDown,
  ChevronRight,
  ExternalLink,
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
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

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

  const handlePublish = async () => {
    if (!receipt) return;
    setIsPublishing(true);
    setError(null);
    try {
      await apiClient.publishReceipt(receipt.id);
      await fetchReceipt();
      setVerifyResult(null);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setIsPublishing(false);
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

  if (isLoading) {
    return (
      <div className="p-12 text-center text-sm text-neutral-500 bg-neutral-900/30 border border-neutral-800 rounded-xl">
        Loading receipt...
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="p-12 text-center bg-neutral-900/30 border border-neutral-800 rounded-xl space-y-3">
        <FileCheck2 size={32} className="mx-auto text-neutral-600" />
        <h4 className="text-sm font-semibold text-neutral-300">
          No Receipt Available
        </h4>
        <p className="text-sm text-neutral-500 max-w-md mx-auto">
          Execute an agent termination to finalize and generate an auditable termination receipt.
        </p>
      </div>
    );
  }

  const isClean = receipt.result === 'clean';
  const isPartial = receipt.result === 'partial';
  const isPublished = receipt.verification_status === 'published';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            Termination Receipt
            <span className="text-xs font-mono font-normal text-neutral-500 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
              {receipt.id.slice(0, 8)}
            </span>
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Generated {formatDateTime(receipt.completed_at).local}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isPublished && publisherConfigured && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isPublishing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg transition-colors shadow-sm"
            >
              <Upload size={16} />
              <span>{isPublishing ? 'Publishing...' : 'Publish to Blockchain'}</span>
            </button>
          )}
          
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg transition-colors shadow-sm"
          >
            <ShieldCheck size={16} />
            <span>{isVerifying ? 'Verifying...' : 'Verify Integrity'}</span>
          </button>
        </div>
      </div>

      <ErrorBanner error={error} title="Receipt Query Failed" />

      {/* Main Status Hero */}
      <div className={`p-6 rounded-xl border flex items-start gap-4 ${
        isClean ? 'bg-emerald-950/20 border-emerald-900/50' :
        isPartial ? 'bg-amber-950/20 border-amber-900/50' :
        'bg-rose-950/20 border-rose-900/50'
      }`}>
        <div className={`p-3 rounded-full shrink-0 ${
          isClean ? 'bg-emerald-500/20 text-emerald-400' :
          isPartial ? 'bg-amber-500/20 text-amber-400' :
          'bg-rose-500/20 text-rose-400'
        }`}>
          {isClean ? <CheckCircle2 size={32} /> : isPartial ? <AlertTriangle size={32} /> : <XCircle size={32} />}
        </div>
        <div className="space-y-1">
          <h3 className={`text-xl font-bold ${
            isClean ? 'text-emerald-100' : isPartial ? 'text-amber-100' : 'text-rose-100'
          }`}>
            {isClean ? 'Clean Termination Verified' : isPartial ? 'Partial Termination' : 'Termination Failed'}
          </h3>
          <p className={`text-sm ${
            isClean ? 'text-emerald-200/80' : isPartial ? 'text-amber-200/80' : 'text-rose-200/80'
          }`}>
            {isClean 
              ? 'All registered permissions were successfully revoked or verified absent on the blockchain.' 
              : isPartial 
                ? 'Termination completed, but some permissions were left unresolved and may require manual action.'
                : 'The termination could not establish a trustworthy outcome.'}
          </p>
        </div>
      </div>

      {/* Verification Status */}
      {verifyResult && (
        <div className={`p-4 rounded-lg border text-sm ${
          verifyResult.verified 
            ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200' 
            : 'bg-rose-950/30 border-rose-900/50 text-rose-200'
        }`}>
          <div className="flex items-center gap-2 font-semibold mb-1">
            {verifyResult.verified ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
            {verifyResult.verified ? 'Integrity Verified' : 'Verification Failed'}
          </div>
          <p className="text-xs opacity-80">
            {verifyResult.verified 
              ? 'The cryptographic hash of this receipt matches the immutable record stored on the NEAR blockchain.' 
              : 'The receipt payload does not match the on-chain commitment, or it has not been published yet.'}
          </p>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Agent Info */}
        <div className="p-5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-4">
          <h4 className="text-sm font-semibold text-neutral-200">Agent Details</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-neutral-800/50 pb-2">
              <span className="text-neutral-500">Target Account</span>
              <span className="font-mono text-neutral-200">{receipt.agent_near_account || 'None'}</span>
            </div>
            <div className="flex justify-between border-b border-neutral-800/50 pb-2">
              <span className="text-neutral-500">Network</span>
              <span className="font-mono uppercase text-neutral-200">{receipt.network}</span>
            </div>
            <div className="flex justify-between pb-1">
              <span className="text-neutral-500">Agent ID</span>
              <span className="font-mono text-xs text-neutral-400 truncate max-w-[150px]">{receipt.agent_id}</span>
            </div>
          </div>
        </div>

        {/* Blockchain Info */}
        <div className="p-5 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-4">
          <h4 className="text-sm font-semibold text-neutral-200">Blockchain Record</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-neutral-800/50 pb-2">
              <span className="text-neutral-500">Status</span>
              <span className={`font-medium ${isPublished ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isPublished ? 'Published' : 'Not Published'}
              </span>
            </div>
            
            <div className="space-y-1 pb-1">
              <span className="text-neutral-500 text-xs">Cryptographic Hash</span>
              <div className="flex items-center gap-2">
                <div className="font-mono text-xs text-neutral-300 bg-neutral-950 p-2 rounded border border-neutral-800 break-all select-all flex-1">
                  {receipt.payload_hash}
                </div>
                <button
                  onClick={() => copyHash(receipt.payload_hash)}
                  className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-400 transition-colors"
                  title="Copy Hash"
                >
                  {copiedHash ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            {receipt.onchain_tx_hash ? (
              <div className="pt-2">
                <a 
                  href={`https://explorer.testnet.near.org/transactions/${receipt.onchain_tx_hash}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline"
                >
                  <ExternalLink size={12} />
                  View Transaction on NEAR Explorer
                </a>
              </div>
            ) : (
              <div className="pt-2 text-xs text-neutral-500 flex items-center gap-1.5">
                <Info size={12} />
                Awaiting publication
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible Raw Payload */}
      <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/40">
        <button
          type="button"
          onClick={() => setShowPayload(!showPayload)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60 transition-colors"
        >
          <span>Technical Details (Raw Payload)</span>
          {showPayload ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        
        {showPayload && (
          <div className="p-4 border-t border-neutral-800">
            <CodeSnippet code={receipt.payload} maxHeight="max-h-96" />
          </div>
        )}
      </div>
    </div>
  );
}