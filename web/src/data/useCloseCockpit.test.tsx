import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCloseCockpit } from './useCloseCockpit';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ lights: [{ key: 'je', status: 'green', label: 'JE', real: true }], status: 'OPEN', anchored: false, staleAnchor: false, closeable: false, reopenCount: 0, restatementReason: null, reasonCode: null }),
  })) as unknown as typeof fetch);
});

it('fetches cockpit for an entity', async () => {
  const { result } = renderHook(() => useCloseCockpit('e1'));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));
  expect(result.current.data?.lights?.[0]?.key).toBe('je');
});

it('does not fetch when entityId is null', () => {
  renderHook(() => useCloseCockpit(null));
  expect(fetch).not.toHaveBeenCalled();
});
