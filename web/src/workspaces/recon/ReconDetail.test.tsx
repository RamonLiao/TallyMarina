// web/src/workspaces/recon/ReconDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconDetail } from './ReconDetail';
import type { ReconRowDTO } from '../../api/types';

vi.mock('../../data/useChainBalance', () => ({ useChainBalance: () => ({ state: 'live', balanceMinor: '5000000000' }) }));

const row: ReconRowDTO = {
  wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', decimals: 9,
  openingMinor: '1200000000', movementMinor: '3800000000', computedMinor: '5000000000',
  statementMinor: '3798000000', breakMinor: '1202000000', thresholdMinor: '1000000000', material: true,
  control: { debitMinor: '5000000000', creditMinor: '1200000000', legs: 2 },
  provenance: { computed: 'book', statement: 'mock', chain: 'live' }, disposition: null,
};

const clientMovements = { '0xacmeTreasury|0x2::sui::SUI': 3800000000n };

describe('ReconDetail', () => {
  it('renders the roll-forward equation with control totals', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored={false} onDisposed={() => {}} clientMovements={clientMovements} />);
    expect(screen.getByText(/Opening balance/i)).toBeInTheDocument();
    expect(screen.getByText(/2 legs/i)).toBeInTheDocument();
    expect(screen.getByText(/threshold/i)).toBeInTheDocument();
  });

  it('shows anchored read-only ribbon and hides disposition controls when anchored', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored onDisposed={() => {}} clientMovements={clientMovements} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve|dismiss|defer/i })).toBeNull();
  });

  it('shows NO drift banner when clientMovements matches DTO', () => {
    // WHY: drift banner must not appear when browser and backend agree
    render(<ReconDetail row={row} realWallet="0xreal" anchored={false} onDisposed={() => {}} clientMovements={clientMovements} />);
    expect(screen.queryByLabelText(/evidence drift/i)).not.toBeInTheDocument();
  });

  it('shows drift banner when clientMovements disagrees with DTO movementMinor', () => {
    // WHY: client recompute is the evidence — backend disagreement must be surfaced loudly
    const badMovements = { '0xacmeTreasury|0x2::sui::SUI': 3700000000n }; // disagrees by 100000000
    render(<ReconDetail row={row} realWallet="0xreal" anchored={false} onDisposed={() => {}} clientMovements={badMovements} />);
    // Both banner and inline span carry aria-label="evidence drift" — verify at least one present
    const driftEls = screen.getAllByLabelText(/evidence drift/i);
    expect(driftEls.length).toBeGreaterThan(0);
    // Banner specifically (role=alert, drift-warn--banner) must carry the full message
    const banner = driftEls.find((el) => el.classList.contains('drift-warn--banner'));
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toMatch(/evidence drift.*browser recomputed.*≠.*backend/i);
  });
});
