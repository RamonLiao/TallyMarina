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
  const { result } = renderHook(() => useCloseCockpit('e1', 'p1'));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));
  expect(result.current.data?.lights?.[0]?.key).toBe('je');
});

it('sends periodId as a query param', async () => {
  // WHY: the backend rejects a cockpit read without ?periodId= with 400
  // PERIOD_ID_REQUIRED (routes.ts PERIOD_ID_REQUIRED guard). A cockpit fetch that
  // omits it silently degrades the whole Close workspace to "No cockpit data.",
  // which hides the Lock panel and makes every later Freeze fail PERIOD_NOT_LOCKED.
  const { result } = renderHook(() => useCloseCockpit('acme:pilot-001', '2026-Q2'));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));
  const url = vi.mocked(fetch).mock.calls[0]![0] as string;
  expect(url).toContain('/entities/acme%3Apilot-001/close-cockpit');
  expect(url).toContain('periodId=2026-Q2');
});

it('does not fetch when entityId is null', () => {
  renderHook(() => useCloseCockpit(null, 'p1'));
  expect(fetch).not.toHaveBeenCalled();
});

it('does not fetch when periodId is empty', () => {
  // WHY: firing a cockpit read with no period is a guaranteed 400 — don't burn it.
  renderHook(() => useCloseCockpit('e1', ''));
  expect(fetch).not.toHaveBeenCalled();
});

it('exposes undefined data immediately when periodId changes (render-gate guarantee)', async () => {
  // WHY: lock/anchor status is period-scoped. Showing 2026-Q1's LOCKED ribbon while
  // 2026-Q2 is still loading would tell the operator the period is closed when it isn't.
  let periodId = '2026-Q1';
  const { result, rerender } = renderHook(() => useCloseCockpit('e1', periodId));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));

  periodId = '2026-Q2';
  rerender();
  expect(result.current.data).toBeUndefined();
});

it('exposes undefined data immediately when entityId changes (render-gate guarantee)', async () => {
  // WHY: the render-gate (state.entityId === entityId) ensures that the moment
  // entityId changes, the exposed data is undefined on the SAME render — no
  // post-commit effect lag, no stale frame for the consumer.
  let entityId: string | null = 'e1';
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId, 'p1'));
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
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId, 'p1'));
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
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId, 'p1'));

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
  const { result, rerender } = renderHook(() => useCloseCockpit(entityId, 'p1'));

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
