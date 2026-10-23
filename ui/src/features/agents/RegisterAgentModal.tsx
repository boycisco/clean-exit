import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal.tsx';
import { ErrorBanner } from '../../components/common/ErrorBanner.tsx';
import { apiClient } from '../../lib/api-client.ts';
import type { Agent, AgentCreateInput } from '../../types/api.ts';

interface RegisterAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAgentCreated: (agent: Agent) => void;
}

export function RegisterAgentModal({
  isOpen,
  onClose,
  onAgentCreated,
}: RegisterAgentModalProps) {
  const [name, setName] = useState('');
  const [nearAccount, setNearAccount] = useState('');
  const [environment, setEnvironment] = useState<'testnet' | 'mainnet'>('testnet');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(new Error('Agent name is required.'));
      return;
    }

    const input: AgentCreateInput = {
      name: trimmedName,
      near_account: nearAccount.trim() || undefined,
      environment,
      description: description.trim() || undefined,
    };

    setIsSubmitting(true);
    try {
      const newAgent = await apiClient.createAgent(input);
      setName('');
      setNearAccount('');
      setDescription('');
      onAgentCreated(newAgent);
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
      title="Register Agent"
      maxWidth="register"
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
            {isSubmitting ? 'Registering...' : 'Register Agent'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner error={error} title="Registration failed" />

        <div className="space-y-1">
          <label htmlFor="agent-name" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Agent Name <span className="text-[var(--status-danger)]">*</span>
          </label>
          <input
            id="agent-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. trading-bot-alpha"
            maxLength={128}
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
            required
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="near-account" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            NEAR Account
          </label>
          <input
            id="near-account"
            type="text"
            value={nearAccount}
            onChange={(e) => setNearAccount(e.target.value)}
            placeholder="e.g. agent.testnet"
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
          />
          <p className="text-[11px] text-[var(--text-muted)]">
            Optional. This account ID cannot be changed after creation.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="environment" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Environment
          </label>
          <select
            id="environment"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'testnet' | 'mainnet')}
            className="w-full h-10 px-3 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors"
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="description" className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Operational scope or purpose of this autonomous agent"
            className="w-full p-2.5 rounded-[6px] bg-[var(--bg-input)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)] transition-colors resize-none"
          />
        </div>
      </form>
    </Modal>
  );
}