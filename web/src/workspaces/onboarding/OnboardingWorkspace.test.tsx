import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ entity: { id: 'acme:pilot-001' } }) }));
vi.mock('@mysten/dapp-kit-react/ui', () => ({ ConnectButton: () => <button>Connect</button> }));
vi.mock('../../data/usePersonalWalletOwnership', () => ({
  usePersonalWalletOwnership: () => ({ account: null, status: 'idle', verify: vi.fn(), reset: vi.fn() }),
}));
const data = {
  entity: { id: 'acme:pilot-001', displayName: 'Acme Pilot', meta: { functionalCurrency: 'USD', reportingCurrency: 'USD', fiscalCalendar: 'Jan–Dec', timezone: 'America/New_York' } },
  sources: [
    { wallet: '0xacmeTreasury', eventCount: 3, isDemoOwned: false, ownership: { verified: false } },
    { wallet: '0xdemoOwned', eventCount: 0, isDemoOwned: true, ownership: { verified: true, verifiedAt: 100 } },
  ],
  unlistedVerified: [],
};
vi.mock('../../data/useOnboardingData', () => ({ useOnboardingData: () => ({ data, loading: false, error: undefined, refetch: vi.fn() }) }));
import { OnboardingWorkspace } from './OnboardingWorkspace';

beforeEach(() => { vi.clearAllMocks(); });

describe('OnboardingWorkspace', () => {
  it('renders entity meta and source rows with ownership badges', () => {
    render(<OnboardingWorkspace />);
    expect(screen.getAllByText('USD').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
    expect(screen.getAllByText(/^UNVERIFIED$/).length).toBeGreaterThanOrEqual(1); // unverified source
    expect(screen.getAllByText(/^VERIFIED$/).length).toBeGreaterThanOrEqual(1);   // demo-owned verified
  });
});
