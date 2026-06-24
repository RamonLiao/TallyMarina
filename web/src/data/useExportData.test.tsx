import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useExportData } from './useExportData';

// Minimal DTO fixtures
const makeJournal = () => [{ id: 'j1', entityId: 'e1', lines: [], createdAt: '' }];
const makeEvents = () => [{ id: 'ev1', entityId: 'e1', type: 'DEBIT', amount: 100, currency: 'USD', purpose: 'TEST', status: 'RAW', createdAt: '' }];
const makeAnchors = () => [{ id: 'a1', entityId: 'e1', digest: 'abc', seq: 1, createdAt: '' }];

// Default: all three endpoints succeed immediately
const makeDefaultMocks = () => {
  vi.mock('../api/endpoints', () => ({
    getJournal: vi.fn(async () => makeJournal()),
    listEvents: vi.fn(async () => makeEvents()),
    getAnchors: vi.fn(async () => ({ anchors: makeAnchors(), inclusionProof: null })),
  }));
};

// We import the mocked module to spy on it
import * as endpoints from '../api/endpoints';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(endpoints.getJournal).mockResolvedValue(makeJournal() as never);
  vi.mocked(endpoints.listEvents).mockResolvedValue(makeEvents() as never);
  vi.mocked(endpoints.getAnchors).mockResolvedValue({ anchors: makeAnchors(), inclusionProof: null } as never);
});

vi.mock('../api/endpoints', () => ({
  getJournal: vi.fn(),
  listEvents: vi.fn(),
  getAnchors: vi.fn(),
}));

it('fetches all three endpoints and returns combined data', async () => {
  const { result } = renderHook(() => useExportData('e1'));
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data?.journal).toHaveLength(1);
  expect(result.current.data?.events).toHaveLength(1);
  expect(result.current.data?.anchors).toHaveLength(1);
  expect(result.current.error).toBeUndefined();
});

it('does not fetch when entityId is empty string', () => {
  renderHook(() => useExportData(''));
  expect(endpoints.getJournal).not.toHaveBeenCalled();
  expect(endpoints.listEvents).not.toHaveBeenCalled();
  expect(endpoints.getAnchors).not.toHaveBeenCalled();
});

it('exposes undefined data immediately when entityId changes (render-gate guarantee)', async () => {
  // WHY: the render-gate (state.entityId === entityId) ensures that the moment
  // entityId changes, the exposed data is undefined on the SAME render — no
  // post-commit effect lag, no stale frame for the consumer.
  let entityId = 'e1';
  const { result, rerender } = renderHook(() => useExportData(entityId));
  await waitFor(() => expect(result.current.data).toBeDefined());

  entityId = 'e2';
  rerender();
  // Render-gate fires synchronously on this render — data is undefined immediately.
  expect(result.current.data).toBeUndefined();
});

it('in-flight prior-entity fetch resolving after entityId switch never surfaces stale data', async () => {
  // WHY: this is the race the render-gate closes. Without it, a slow e1 fetch
  // that resolves after entityId → null (no new fetch) would write e1 payload
  // into state and expose it on the next render because state.entityId='e1'
  // would match the last-seen entityId. The render-gate rejects it at render
  // time: state.entityId ('e1') !== current entityId ('').
  //
  // We use entityId='' (empty) as the "no entity" state because the hook skips
  // fetching on empty string, so no new fetch races against e1's deferred fetch.

  // Deferred resolvers for e1's parallel fetches
  let resolveJournal!: (v: unknown) => void;
  let resolveEvents!: (v: unknown) => void;
  let resolveAnchors!: (v: unknown) => void;

  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise(res => { resolveJournal = res; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise(res => { resolveEvents = res; }) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise(res => { resolveAnchors = res; }) as never
  );

  let entityId = 'e1';
  const { result, rerender } = renderHook(() => useExportData(entityId));

  // e1 fetch is pending. Switch to empty (no fetch issued for empty).
  entityId = '';
  rerender();
  // Render-gate fires immediately — data undefined because state.entityId ('e1') !== ''
  expect(result.current.data).toBeUndefined();

  // Now resolve the in-flight e1 fetches late.
  await act(async () => {
    resolveJournal([{ id: 'j-stale', entityId: 'e1', lines: [], createdAt: '' }]);
    resolveEvents([]);
    resolveAnchors({ anchors: [], inclusionProof: null });
    await Promise.resolve();
    await Promise.resolve();
  });

  // The render-gate must block e1's payload from surfacing under entityId=''.
  // state.entityId will be 'e1' but current entityId is '' → gated out.
  // (genRef check also discards it since entityId changed and gen was bumped by
  // the empty-string rerender path, but the render-gate is the final safety net.)
  expect(result.current.data).toBeUndefined();
});

it('error is also gated — prior entity error does not bleed to new entityId', async () => {
  // WHY: an error from e1's fetch must not appear when entityId has moved to e2.
  let rejectFetches!: (err: Error) => void;

  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise((_res, rej) => { rejectFetches = rej; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise((_res, rej) => { /* same reject handle */ rej; }) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise((_res, rej) => { rej; }) as never
  );

  let entityId = 'e1';
  const { result, rerender } = renderHook(() => useExportData(entityId));

  entityId = 'e2';
  // e2 endpoints succeed (beforeEach mocks)
  rerender();

  // Reject the e1 fetch.
  await act(async () => {
    rejectFetches(new Error('e1 network error'));
    await Promise.resolve();
    await Promise.resolve();
  });

  // e1's error must be gated out (state.entityId 'e1' !== current 'e2').
  expect(result.current.error).toBeUndefined();
});

it('sets error state when fetch fails (fail-loud)', async () => {
  vi.mocked(endpoints.getJournal).mockRejectedValueOnce(new Error('server error') as never);

  const { result } = renderHook(() => useExportData('e1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('server error');
  expect(result.current.data).toBeUndefined();
});

it('loading transitions correctly', async () => {
  let resolveAll!: (v: unknown) => void;
  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise(res => { resolveAll = res; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise(res => res(makeEvents())) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise(res => res({ anchors: makeAnchors(), inclusionProof: null })) as never
  );

  const { result } = renderHook(() => useExportData('e1'));
  // loading starts true
  expect(result.current.loading).toBe(true);

  await act(async () => {
    resolveAll(makeJournal());
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toBeDefined();
});
