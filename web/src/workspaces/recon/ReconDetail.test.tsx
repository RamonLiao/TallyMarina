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

describe('ReconDetail', () => {
  it('renders the roll-forward equation with control totals', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored={false} onDisposed={() => {}} />);
    expect(screen.getByText(/Opening balance/i)).toBeInTheDocument();
    expect(screen.getByText(/2 legs/i)).toBeInTheDocument();
    expect(screen.getByText(/threshold/i)).toBeInTheDocument();
  });

  it('shows anchored read-only ribbon and hides disposition controls when anchored', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored onDisposed={() => {}} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve|dismiss|defer/i })).toBeNull();
  });
});
