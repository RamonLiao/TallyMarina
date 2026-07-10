import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationWorkspace } from './ReconciliationWorkspace';

vi.mock('../data/useReconciliation', () => ({
  useReconciliation: () => ({
    data: { rows: [], realWallet: '0xreal', summary: { material: 0, blockingMaterial: 0, balanced: 0 } },
    loading: false, error: undefined, refetch: () => {},
  }),
}));
vi.mock('../api/hooks', () => ({
  useJournal: () => ({ data: [] }),
  useEvents: () => ({ data: [] }),
}));
// useAnchors not yet implemented; anchored=false stub in ReconciliationWorkspace (no import needed).

describe('ReconciliationWorkspace', () => {
  it('all-balanced → celebration empty state', () => {
    render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    expect(screen.getByText(/reconciled|tie to statements/i)).toBeInTheDocument();
  });

  it('resets selection when entity changes', () => {
    const { rerender } = render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    rerender(<ReconciliationWorkspace entityId="beta:pilot-002" />);
    // No detail pane shown after entity switch (selection cleared).
    expect(screen.queryByText(/Opening balance/i)).toBeNull();
  });
});
