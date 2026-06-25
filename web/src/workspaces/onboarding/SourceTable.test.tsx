import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OnboardingDTO } from '../../api/types';

// usePersonalWalletOwnership is mocked per-test via this mutable holder so each case can
// inject a different connected account without re-mocking the module.
const hook = { account: null as null | { address: string }, status: 'idle', errorCode: undefined as string | undefined, verify: vi.fn() };
vi.mock('../../data/usePersonalWalletOwnership', () => ({ usePersonalWalletOwnership: () => hook }));

import { SourceTable } from './SourceTable';

const data: OnboardingDTO = {
  entity: { id: 'e', displayName: 'E', meta: { functionalCurrency: 'USD', reportingCurrency: 'USD', fiscalCalendar: 'Jan–Dec', timezone: 'UTC' } },
  sources: [{ wallet: '0xacmeTreasury', eventCount: 3, isDemoOwned: false, ownership: { verified: false } }],
  unlistedVerified: [],
} as unknown as OnboardingDTO;

beforeEach(() => {
  hook.account = null;
  hook.status = 'idle';
  hook.errorCode = undefined;
  hook.verify = vi.fn().mockResolvedValue(true);
});

describe('SourceTable wallet-ownership guard', () => {
  it('short-circuits a connected-wallet ≠ source-row click with the clear message and no backend round-trip', async () => {
    // WHY: the most common slip is connecting wallet A then clicking Verify on wallet B's row.
    // The backend route guard rejects this as a generic VALIDATION error; mirroring it client-side
    // surfaces "Connected wallet ≠ this source" and avoids a pointless challenge+sign round-trip.
    hook.account = { address: '0x00000000000000000000000000000000000000000000000000000000deadbeef' };
    render(<SourceTable data={data} onVerified={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Verify ownership' }));

    await waitFor(() => expect(screen.getByText('Connected wallet ≠ this source')).toBeInTheDocument());
    expect(hook.verify).not.toHaveBeenCalled();
  });

  it('clears the mismatch message the same frame when the connected account changes to match', () => {
    // WHY: the message is render-derived (not stored state), so switching the connected wallet to
    // the matching one removes the stale "≠ this source" without a click or post-commit effect.
    hook.account = { address: '0x00000000000000000000000000000000000000000000000000000000deadbeef' };
    const { rerender } = render(<SourceTable data={data} onVerified={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify ownership' }));
    expect(screen.getByText('Connected wallet ≠ this source')).toBeInTheDocument();

    hook.account = { address: '0xacmeTreasury' }; // user reconnects the matching wallet
    rerender(<SourceTable data={data} onVerified={vi.fn()} />);
    expect(screen.queryByText('Connected wallet ≠ this source')).not.toBeInTheDocument();
  });

  it('proceeds to verify when the connected wallet matches the source row', async () => {
    hook.account = { address: '0xacmeTreasury' };
    render(<SourceTable data={data} onVerified={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Verify ownership' }));

    await waitFor(() => expect(hook.verify).toHaveBeenCalledWith('0xacmeTreasury'));
    expect(screen.queryByText('Connected wallet ≠ this source')).not.toBeInTheDocument();
  });
});
