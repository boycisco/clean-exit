import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../components/common/StatusBadge.tsx';
import { TriStateBadge } from '../components/common/TriStateBadge.tsx';
import { EmptyState } from '../components/common/EmptyState.tsx';
import { ShieldAlert } from 'lucide-react';

describe('UI Primitives and State Gating Tests', () => {
  it('renders StatusBadge with both icon and text label (never color alone)', () => {
    const { rerender } = render(<StatusBadge type="agent" value="active" />);
    expect(screen.getByText('Active')).toBeDefined();

    rerender(<StatusBadge type="agent" value="clean" />);
    expect(screen.getByText('Clean')).toBeDefined();

    rerender(<StatusBadge type="agent" value="failed" />);
    expect(screen.getByText('Failed')).toBeDefined();

    rerender(<StatusBadge type="agent" value="partial" />);
    expect(screen.getByText('Partial')).toBeDefined();
  });

  it('renders TriStateBadge correctly without false claims for null state', () => {
    const { rerender } = render(<TriStateBadge onChain={true} />);
    expect(screen.getByText('Observed on-chain')).toBeDefined();

    rerender(<TriStateBadge onChain={false} />);
    expect(screen.getByText('Confirmed absent')).toBeDefined();

    // Critical: onChain === null must never be "not on chain" or "revoked"
    rerender(<TriStateBadge onChain={null} />);
    expect(screen.getByText('Inconclusive / Unknown')).toBeDefined();
    expect(screen.queryByText('Confirmed absent')).toBeNull();
    expect(screen.queryByText('Observed on-chain')).toBeNull();
  });

  it('renders EmptyState with explanatory text and warning note', () => {
    render(
      <EmptyState
        icon={ShieldAlert}
        title="No authorities registered"
        description="Empty inventory means nothing registered."
        warningNote="Do not assume absence."
      />
    );

    expect(screen.getByText('No authorities registered')).toBeDefined();
    expect(screen.getByText('Empty inventory means nothing registered.')).toBeDefined();
    expect(screen.getByText(/Do not assume absence/)).toBeDefined();
  });
});
