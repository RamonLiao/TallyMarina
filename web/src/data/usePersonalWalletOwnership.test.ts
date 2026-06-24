import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const signPersonalMessage = vi.fn();
vi.mock('@mysten/dapp-kit-react', () => ({
  useDAppKit: () => ({ signPersonalMessage }),
  useCurrentAccount: () => ({ address: '0xabc' }),
}));
vi.mock('../api/endpoints', () => ({
  postOnboardingChallenge: vi.fn(),
  postOnboardingVerify: vi.fn(),
}));
import { usePersonalWalletOwnership } from './usePersonalWalletOwnership';
import { postOnboardingChallenge, postOnboardingVerify } from '../api/endpoints';

beforeEach(() => { vi.clearAllMocks(); });

describe('usePersonalWalletOwnership', () => {
  it('runs challenge → sign → verify and lands on verified', async () => {
    (postOnboardingChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({ nonce: 'n', message: 'MSG', expiresAt: 1, wallet: '0xabc' });
    signPersonalMessage.mockResolvedValue({ bytes: 'b64', signature: 'sigb64' });
    (postOnboardingVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ verdict: 'VERIFIED', attestation: {} });

    const { result } = renderHook(() => usePersonalWalletOwnership());
    await act(async () => { await result.current.verify('0xabc'); });
    await waitFor(() => expect(result.current.status).toBe('verified'));
    expect(signPersonalMessage).toHaveBeenCalledWith({ message: new TextEncoder().encode('MSG') });
    expect(postOnboardingVerify).toHaveBeenCalledWith({ wallet: '0xabc', nonce: 'n', signature: 'sigb64', connectedAccount: '0xabc' });
  });

  it('maps a verify failure to error status + errorCode', async () => {
    (postOnboardingChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({ nonce: 'n', message: 'MSG', expiresAt: 1, wallet: '0xabc' });
    signPersonalMessage.mockResolvedValue({ bytes: 'b64', signature: 'sigb64' });
    (postOnboardingVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ADDRESS_MISMATCH: nope'));

    const { result } = renderHook(() => usePersonalWalletOwnership());
    await act(async () => { await result.current.verify('0xabc'); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toContain('ADDRESS_MISMATCH');
  });
});
