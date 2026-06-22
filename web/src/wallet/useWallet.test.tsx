import { renderHook, act } from '@testing-library/react';
import { vi, it, expect, beforeEach } from 'vitest';

const { signAndExecuteTransaction, fromMock, useCurrentAccountMock } = vi.hoisted(() => ({
  signAndExecuteTransaction: vi.fn(),
  fromMock: vi.fn((kind: string) => ({ __tx: kind })),
  useCurrentAccountMock: vi.fn<[], { address: string } | null>(() => ({ address: '0xwallet' })),
}));

vi.mock('@mysten/dapp-kit-react', () => ({
  useDAppKit: () => ({ signAndExecuteTransaction }),
  useCurrentAccount: useCurrentAccountMock,
}));
vi.mock('@mysten/sui/transactions', () => ({ Transaction: { from: fromMock } }));

import { useWallet } from './useWallet';

beforeEach(() => {
  signAndExecuteTransaction.mockReset();
  fromMock.mockClear();
  useCurrentAccountMock.mockReset();
  useCurrentAccountMock.mockReturnValue({ address: '0xwallet' });
});

it('builds Transaction.from(txKind) and returns the success digest', async () => {
  signAndExecuteTransaction.mockResolvedValue({ Transaction: { digest: '0xDIGEST' } });
  const { result } = renderHook(() => useWallet());
  let out: { digest: string } | undefined;
  await act(async () => { out = await result.current.signAndExecute('IR_KIND'); });
  expect(fromMock).toHaveBeenCalledWith('IR_KIND');
  expect(signAndExecuteTransaction).toHaveBeenCalledWith({ transaction: { __tx: 'IR_KIND' } });
  expect(out).toEqual({ digest: '0xDIGEST' });
  expect(result.current.address).toBe('0xwallet');
});

it('throws when the wallet returns FailedTransaction (rejection/abort)', async () => {
  signAndExecuteTransaction.mockResolvedValue({ FailedTransaction: { status: { error: { message: 'user rejected' } } } });
  const { result } = renderHook(() => useWallet());
  await expect(result.current.signAndExecute('IR_KIND')).rejects.toThrow(/user rejected/);
});

it('returns null address when useCurrentAccount returns null (null-safety regression guard)', () => {
  // This test MUST fail if the null-safety (`account?.address ?? null`) in useWallet is regressed.
  useCurrentAccountMock.mockReturnValue(null);
  const { result } = renderHook(() => useWallet());
  expect(result.current.address).toBeNull();
});

it('signAndExecute rejects when account is null (wallet not connected)', async () => {
  useCurrentAccountMock.mockReturnValue(null);
  signAndExecuteTransaction.mockRejectedValue(new Error('Wallet not connected'));
  const { result } = renderHook(() => useWallet());
  expect(result.current.address).toBeNull();
  await expect(result.current.signAndExecute('IR_KIND')).rejects.toThrow();
});
