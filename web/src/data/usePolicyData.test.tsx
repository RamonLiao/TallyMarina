import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePolicyData } from './usePolicyData';

import * as endpoints from '../api/endpoints';

const makePolicyActive = (entityId = 'e1') => ({
  policySet: { policySetVersion: 'demo-ps-1' },
  coaMapping: { rules: [], defaultAccount: null, version: 1, ruleVersion: 'rv-1' },
  periodId: 'p1',
  policyDoc: { policySetVersion: 'demo-ps-1' },
  policyVersion: 1,
  coaVersion: 1,
  entityId,
});

vi.mock('../api/endpoints', () => ({
  getJournal: vi.fn(),
  listEvents: vi.fn(),
  getPolicyActive: vi.fn(),
  patchPolicySet: vi.fn(),
  putCoaMapping: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(endpoints.getJournal).mockResolvedValue([] as never);
  vi.mocked(endpoints.listEvents).mockResolvedValue([] as never);
  vi.mocked(endpoints.getPolicyActive).mockResolvedValue(makePolicyActive() as never);
});

it('fetches policy active with the entityId', async () => {
  const { result } = renderHook(() => usePolicyData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(endpoints.getPolicyActive).toHaveBeenCalledWith('e1');
});

it('applyPolicyChanges calls patchPolicySet and refetches on success', async () => {
  vi.mocked(endpoints.patchPolicySet).mockResolvedValue({
    policyVersion: 2, policyDoc: { policySetVersion: 'demo-ps-2' },
  } as never);

  const { result } = renderHook(() => usePolicyData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(endpoints.getPolicyActive).toHaveBeenCalledTimes(1);

  await act(async () => {
    await result.current.applyPolicyChanges({ functionalCurrency: 'USD' } as never, 'reason', 'actor1');
  });

  expect(endpoints.patchPolicySet).toHaveBeenCalledWith({
    entity: 'e1', actor: 'actor1', reason: 'reason', changes: { functionalCurrency: 'USD' },
  });
  // refetch triggered: getPolicyActive called again after mutation
  expect(endpoints.getPolicyActive).toHaveBeenCalledTimes(2);
});

it('applyPolicyChanges throws on API error and does not swallow it', async () => {
  vi.mocked(endpoints.patchPolicySet).mockRejectedValue(new Error('CURRENCY_LOCKED'));

  const { result } = renderHook(() => usePolicyData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());

  await expect(
    act(async () => {
      await result.current.applyPolicyChanges({} as never, 'reason', 'actor1');
    })
  ).rejects.toThrow('CURRENCY_LOCKED');
});

it('applyCoaMapping calls putCoaMapping and refetches on success', async () => {
  vi.mocked(endpoints.putCoaMapping).mockResolvedValue({
    coaVersion: 2, ruleVersion: 'rv-2', policyVersion: 1, rules: [],
  } as never);

  const { result } = renderHook(() => usePolicyData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(endpoints.getPolicyActive).toHaveBeenCalledTimes(1);

  await act(async () => {
    await result.current.applyCoaMapping([{ eventType: 'X', leg: 'debit', account: 'A' }] as never, 'reason', 'actor1');
  });

  expect(endpoints.putCoaMapping).toHaveBeenCalledWith({
    entity: 'e1', actor: 'actor1', reason: 'reason', rules: [{ eventType: 'X', leg: 'debit', account: 'A' }],
  });
  expect(endpoints.getPolicyActive).toHaveBeenCalledTimes(2);
});

it('applyCoaMapping throws on API error and does not swallow it', async () => {
  vi.mocked(endpoints.putCoaMapping).mockRejectedValue(new Error('DUPLICATE_RULE'));

  const { result } = renderHook(() => usePolicyData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());

  await expect(
    act(async () => {
      await result.current.applyCoaMapping([] as never, 'reason', 'actor1');
    })
  ).rejects.toThrow('DUPLICATE_RULE');
});
