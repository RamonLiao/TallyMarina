import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCloseCockpit } from './useCloseCockpit';

const makePayload = (status = 'OPEN') => ({
  lights: [{ key: 'je', status: 'green', label: 'JE', real: true }],
  status,
  anchored: false,
  staleAnchor: false,
  closeable: false,
  reopenCount: 0,
  restatementReason: null,
  reasonCode: null,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => makePayload(),
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

it('exposes undefined data immediately when entityId changes (render-gate guarantee)', async () => {
  // WHY: the render-gate (state.entityId === entityId) ensures that the moment
  // entityId changes, the exposed data is undefined on the SAME render — no
  // post-commit effect lag, no stale frame for the consumer.
  let entityId: string | null = 'e1';
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));

  entityId = 'e2';
  rerender();
  // Render-gate fires synchronously on this render — data is undefined immediately.
  expect(result.current.data).toBeUndefined();
});

it('exposes undefined data immediately when entityId becomes null (render-gate guarantee)', async () => {
  // WHY: same render-gate applies to null; operator must not see a prior entity's
  // lock/anchor status when no entity is selected.
  let entityId: string | null = 'e1';
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));

  entityId = null;
  rerender();
  expect(result.current.data).toBeUndefined();
});

it('in-flight prior-entity fetch resolving after entityId switch never surfaces stale data', async () => {
  // WHY: this is the race the render-gate closes. Without it, a slow e1 fetch
  // that resolves after entityId → null would write e1 payload into state and
  // expose it on the next render. The render-gate rejects it because
  // state.entityId ('e1') !== entityId (null).

  let resolveFetch!: (value: unknown) => void;
  const slowFetch = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
  vi.stubGlobal('fetch', slowFetch as unknown as typeof fetch);

  let entityId: string | null = 'e1';
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId));

  // Switch to null before the slow e1 fetch resolves.
  entityId = null;
  rerender();
  expect(result.current.data).toBeUndefined();

  // Now resolve the in-flight e1 fetch.
  await act(async () => {
    resolveFetch({
      ok: true,
      json: async () => makePayload('LOCKED'),
    });
    // Let microtasks/promises settle.
    await Promise.resolve();
    await Promise.resolve();
  });

  // The render-gate must block e1's payload from surfacing.
  // WHY: state.entityId will be 'e1' but current entityId is null → gated out.
  expect(result.current.data).toBeUndefined();
});

it('error is also gated — prior entity error does not bleed', async () => {
  // WHY: an error from e1's fetch must not appear when entityId has moved to e2.
  let rejectFetch!: (err: Error) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((_res, rej) => { rejectFetch = rej; })) as unknown as typeof fetch);

  let entityId: string | null = 'e1';
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId));

  entityId = 'e2';
  // Replace fetch with a success for e2 before rerender.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => makePayload() })) as unknown as typeof fetch);
  rerender();

  // Reject the original e1 fetch (out of order).
  await act(async () => {
    rejectFetch(new Error('e1 error'));
    await Promise.resolve();
    await Promise.resolve();
  });

  // e1's error must be gated out (state.entityId 'e1' !== current 'e2').
  expect(result.current.error).toBeUndefined();
});
