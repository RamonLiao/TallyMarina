import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOnboardingData } from './useOnboardingData';
import * as endpoints from '../api/endpoints';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const dto = (id: string) => ({ entity: { id, displayName: id, meta: null }, sources: [], unlistedVerified: [] });

beforeEach(() => { vi.restoreAllMocks(); });

describe('useOnboardingData', () => {
  it('exposes data for the current entity only (cross-key gate)', async () => {
    const dA = deferred<ReturnType<typeof dto>>();
    const dB = deferred<ReturnType<typeof dto>>();
    const spy = vi.spyOn(endpoints, 'getOnboarding')
      .mockImplementationOnce(() => dA.promise as never)
      .mockImplementationOnce(() => dB.promise as never);

    const { result, rerender } = renderHook(({ id }) => useOnboardingData(id), { initialProps: { id: 'A' } });
    rerender({ id: 'B' });          // switch entity before A resolves
    dA.resolve(dto('A'));            // late A response must NOT surface
    dB.resolve(dto('B'));
    await waitFor(() => expect(result.current.data?.entity.id).toBe('B'));
    expect(result.current.data?.entity.id).not.toBe('A');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
