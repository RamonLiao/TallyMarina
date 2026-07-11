import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationWorkspace } from './ReconciliationWorkspace';
import type { ReconciliationResponse, ReconRowDTO } from '../api/types';

// Data-driven mock so each test can vary the reconciliation payload (the badge branch only renders
// with non-empty, non-balanced rows — an empty payload early-returns to the celebration state).
let reconData: ReconciliationResponse;
vi.mock('../data/useReconciliation', () => ({
  useReconciliation: () => ({ data: reconData, loading: false, error: undefined, refetch: () => {} }),
}));
vi.mock('../api/hooks', () => ({
  useJournal: () => ({ data: [] }),
  useEvents: () => ({ data: [] }),
}));
// useAnchors not yet implemented; anchored=false stub in ReconciliationWorkspace (no import needed).

const unregisteredRow: ReconRowDTO = {
  wallet: '0x7a', coinType: '0xbeef::usdc::USDC', decimals: null, symbol: null,
  assetSource: null, unregisteredAsset: true, precision: null,
  openingMinor: '5000000000', movementMinor: '0', computedMinor: '5000000000',
  statementMinor: '5000500000', breakMinor: '-500000', thresholdMinor: '100000',
  material: true, control: { debitMinor: '0', creditMinor: '0', legs: 0 },
  provenance: { computed: 'book', statement: 'mock', chain: 'n/a' }, disposition: null,
};

beforeEach(() => {
  reconData = { rows: [], realWallet: '0xreal', summary: { material: 0, blockingMaterial: 0, balanced: 0, unregistered: 0 } };
});

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

  it('numerically-balanced unregistered asset must NOT show the balanced empty state', () => {
    // WHY: breakMinor is raw minor units, scale-independent. A numerically-zero break does NOT
    // mean the scale is known — an unregistered asset (decimals unknown) still blocks close on the
    // backend (unregisteredAssetBlockers). If allBalanced only inspects breakMinor it renders the
    // "Books balanced" celebration and hides both the ⛔ row and the summary badge, so the operator
    // hits a 409 UNREGISTERED_ASSETS_BLOCKING at freeze with no on-screen cause (spec §6.3.1 + §6.5.4).
    const balancedUnregistered: ReconRowDTO = {
      ...unregisteredRow,
      breakMinor: '0', material: false,
      computedMinor: '5000000000', statementMinor: '5000000000',
    };
    reconData = {
      rows: [balancedUnregistered], realWallet: '0xreal',
      summary: { material: 0, blockingMaterial: 0, balanced: 0, unregistered: 1 },
    };
    render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    // Must NOT show the balanced empty state.
    expect(screen.queryByText(/Books balanced/i)).toBeNull();
    // Must show the registry blocker summary badge.
    expect(screen.getByText(/1 unregistered asset — blocks close/i)).toBeInTheDocument();
    // Must render the row's ⛔ Unregistered pill.
    expect(screen.getByText(/⛔ Unregistered/)).toBeInTheDocument();
  });

  it('shows the registry badge FIRST when both blockers are nonzero', () => {
    // WHY: registry and materiality are orthogonal blockers that can both be nonzero. The registry
    // badge must win — an unknown scale makes the materiality verdict itself unreliable. Without the
    // registry branch this row's material break badge would show instead, hiding the harder blocker.
    reconData = {
      rows: [unregisteredRow], realWallet: '0xreal',
      summary: { material: 1, blockingMaterial: 1, balanced: 0, unregistered: 1 },
    };
    render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    expect(screen.getByText(/1 unregistered asset — blocks close/i)).toBeInTheDocument();
    expect(screen.queryByText(/material break.*block close/i)).toBeNull();
  });
});
