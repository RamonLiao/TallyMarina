import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconDetail } from './ReconDetail';
import type { ReconRowDTO } from '../../api/types';

vi.mock('../../data/useChainBalance', () => ({ useChainBalance: () => ({ state: 'n/a' }) }));

// unregisteredAsset is ORTHOGONAL to material — a row can be both. The backend
// (unregisteredAssetBlockers) blocks close regardless of disposition, so a UI that renders
// Dismiss here would let the user cosmetically clear a control gap and then hit 409 at freeze.
const unregisteredAndMaterial: ReconRowDTO = {
  wallet: '0x7a', coinType: '0xbeef::usdc::USDC', decimals: null, symbol: null,
  assetSource: null, unregisteredAsset: true, precision: null,
  openingMinor: '5000000000', movementMinor: '0', computedMinor: '5000000000',
  // break = computed − statement = -500000; threshold 100000 → |break| ≥ threshold, so
  // ReconDetail's client-side computeBreak ALSO returns material. Without this the disposition
  // block never renders and the "suppresses controls" assertion would pass vacuously.
  statementMinor: '5000500000', breakMinor: '-500000', thresholdMinor: '100000',
  material: true, control: { debitMinor: '0', creditMinor: '0', legs: 0 },
  provenance: { computed: 'book', statement: 'mock', chain: 'n/a' },
  disposition: null,
};

describe('ReconDetail cannot dismiss an unregistered asset', () => {
  it('suppresses every disposition control when the scale is unknown', () => {
    // WHY (D12): ReconDetail rendered Resolve/Defer/Dismiss on b.material alone. A cosmetic dismiss
    // would clear a control gap the backend still blocks on — a UI-only guard failing open.
    render(<ReconDetail row={unregisteredAndMaterial} realWallet={null} anchored={false} onDisposed={() => {}} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /defer/i })).toBeNull();
  });

  it('offers a route to register the asset instead', () => {
    render(<ReconDetail row={unregisteredAndMaterial} realWallet={null} anchored={false} onDisposed={() => {}} />);
    expect(screen.getByText(/register asset/i)).toBeInTheDocument();
  });
});
