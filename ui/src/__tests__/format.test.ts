import { describe, it, expect } from 'vitest';
import {
  formatTriStateOnChain,
  getAgentStatusMeta,
  getAuthorityStateMeta,
  getJobPhaseMeta,
  formatDateTime,
} from '../lib/format.ts';

describe('Format & State Mapping Contract Tests', () => {
  it('correctly implements tri-state on_chain interpretation', () => {
    // on_chain: true -> observed on chain
    const trueResult = formatTriStateOnChain(true);
    expect(trueResult.label).toBe('Observed on-chain');
    expect(trueResult.variant).toBe('positive');

    // on_chain: false -> confirmed absent
    const falseResult = formatTriStateOnChain(false);
    expect(falseResult.label).toBe('Confirmed absent');
    expect(falseResult.variant).toBe('negative');

    // on_chain: null -> Inconclusive / Unknown (NEVER "not on chain")
    const nullResult = formatTriStateOnChain(null);
    expect(nullResult.label).toBe('Inconclusive / Unknown');
    expect(nullResult.label).not.toContain('absent');
    expect(nullResult.label).not.toContain('revoked');
    expect(nullResult.variant).toBe('neutral');
  });

  it('distinguishes revoked from expired authority states', () => {
    const revokedMeta = getAuthorityStateMeta('revoked');
    const expiredMeta = getAuthorityStateMeta('expired');

    expect(revokedMeta.label).toBe('Revoked');
    expect(revokedMeta.description).toContain('Clean Exit revocation transaction');

    expect(expiredMeta.label).toBe('Expired');
    expect(expiredMeta.description).toContain('before Clean Exit intervention');
    expect(revokedMeta.label).not.toBe(expiredMeta.label);
  });

  it('marks terminal agent lifecycle statuses correctly', () => {
    expect(getAgentStatusMeta('active').isTerminal).toBe(false);
    expect(getAgentStatusMeta('terminating').isTerminal).toBe(false);
    expect(getAgentStatusMeta('clean').isTerminal).toBe(true);
    expect(getAgentStatusMeta('partial').isTerminal).toBe(true);
    expect(getAgentStatusMeta('failed').isTerminal).toBe(true);
  });

  it('maintains the strict sequential phase order for termination jobs', () => {
    const phases = [
      'validate',
      'inventory',
      'plan',
      'revoke',
      'resolve_obligations',
      'verify',
      'finalize',
      'complete',
    ] as const;

    phases.forEach((p, idx) => {
      const meta = getJobPhaseMeta(p);
      expect(meta.order).toBe(idx + 1);
      expect(meta.label).toBeDefined();
    });
  });

  it('formats dual local and UTC time strings', () => {
    const iso = '2026-10-23T14:32:11.456Z';
    const formatted = formatDateTime(iso);
    expect(formatted.utc).toBe(iso);
    expect(formatted.local).toBeTruthy();
  });
});
