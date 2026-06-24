import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useExportData } from './useExportData';

// Minimal DTO fixtures
const makeJournal = (id = 'j1', entityId = 'e1') => [{ id, entityId, lines: [], createdAt: '' }];
const makeEvents = (id = 'ev1', entityId = 'e1') => [{ id, entityId, type: 'DEBIT', amount: 100, currency: 'USD', purpose: 'TEST', status: 'RAW', createdAt: '' }];
const makeAnchors = (id = 'a1', entityId = 'e1') => [{ id, entityId, digest: 'abc', seq: 1, createdAt: '' }];

// We import the mocked module to spy on it
import * as endpoints from '../api/endpoints';

const makePolicyActive = () => ({ policySet: { policySetVersion: 'demo-ps-1' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(endpoints.getJournal).mockResolvedValue(makeJournal() as never);
  vi.mocked(endpoints.listEvents).mockResolvedValue(makeEvents() as never);
  vi.mocked(endpoints.getAnchors).mockResolvedValue({ anchors: makeAnchors(), inclusionProof: null } as never);
  vi.mocked(endpoints.getPolicyActive).mockResolvedValue(makePolicyActive() as never);
});

vi.mock('../api/endpoints', () => ({
  getJournal: vi.fn(),
  listEvents: vi.fn(),
  getAnchors: vi.fn(),
  getPolicyActive: vi.fn(),
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

it('in-flight prior-entity fetch resolving after entityId switch never surfaces stale data (e1→empty)', async () => {
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
  expect(result.current.data).toBeUndefined();
});

it('in-flight e1 fetch resolving after switch to e2 (non-empty) never surfaces e1 data (A→B render-gate)', async () => {
  // WHY: the production-critical race scenario — both e1 and e2 are real entities.
  // Without the render-gate, a late e1 response arriving after entityId='e2' would
  // overwrite state with entityId:'e1', and since the consumer checks state.entityId
  // === currentEntityId, it would get gated out — but ONLY because of the gate.
  // This test proves the gate works for the non-empty→non-empty case:
  // state.entityId ('e1') !== current entityId ('e2') → e1 data is forever blocked,
  // even though both are valid entity strings. genRef alone cannot close this: it
  // protects against stale async writes but the render-gate is the final render-time
  // check. If someone removed the render-gate and just returned state.value directly,
  // this test would fail.

  // Deferred resolvers for e1's fetches (will be resolved late — after e2 switch)
  let resolveE1Journal!: (v: unknown) => void;
  let resolveE1Events!: (v: unknown) => void;
  let resolveE1Anchors!: (v: unknown) => void;

  // Deferred resolvers for e2's fetches
  let resolveE2Journal!: (v: unknown) => void;
  let resolveE2Events!: (v: unknown) => void;
  let resolveE2Anchors!: (v: unknown) => void;

  // e1 mocks — hang until manually resolved
  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise(res => { resolveE1Journal = res; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise(res => { resolveE1Events = res; }) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise(res => { resolveE1Anchors = res; }) as never
  );

  // e2 mocks — also deferred so we control order
  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise(res => { resolveE2Journal = res; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise(res => { resolveE2Events = res; }) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise(res => { resolveE2Anchors = res; }) as never
  );

  let entityId = 'e1';
  const { result, rerender } = renderHook(() => useExportData(entityId));

  // e1 fetch is pending. Switch to e2 (also non-empty — this is the production case).
  entityId = 'e2';
  rerender();

  // Render-gate fires immediately: state.entityId ('e1') !== 'e2' → data undefined.
  expect(result.current.data).toBeUndefined();

  // Resolve e1's fetch LATE (simulating slow network / out-of-order response).
  await act(async () => {
    resolveE1Journal(makeJournal('j-e1-stale', 'e1'));
    resolveE1Events(makeEvents('ev-e1-stale', 'e1'));
    resolveE1Anchors({ anchors: makeAnchors('a-e1-stale', 'e1'), inclusionProof: null });
    await Promise.resolve();
    await Promise.resolve();
  });

  // THE CRITICAL ASSERTION: e1's data must never surface while entityId='e2'.
  // render-gate: state.entityId ('e1') !== current entityId ('e2') → blocked.
  // If useExportData were changed to return state.value directly (no gate), this
  // would expose e1's journal — and this test would fail. That's what makes it real.
  expect(result.current.data).toBeUndefined();
  // Also confirm it's not accidentally exposing e1's journal id
  expect(result.current.data?.journal?.[0]?.id).not.toBe('j-e1-stale');

  // Now resolve e2's fetch — confirms the hook still works correctly after e1 noise.
  await act(async () => {
    resolveE2Journal(makeJournal('j-e2', 'e2'));
    resolveE2Events(makeEvents('ev-e2', 'e2'));
    resolveE2Anchors({ anchors: makeAnchors('a-e2', 'e2'), inclusionProof: null });
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(result.current.data).toBeDefined());
  // e2's data must surface correctly
  expect(result.current.data?.journal?.[0]?.id).toBe('j-e2');
});

it('error is also gated — prior entity error does not bleed to new entityId', async () => {
  // WHY: an error from e1's fetch must not appear when entityId has moved to e2.
  // All three e1 endpoints reject; only getJournal's rejector is needed since
  // Promise.all rejects on the first failure — but we wire all three correctly
  // so this test truly rejects what it claims to reject.
  let rejectE1Journal!: (err: Error) => void;
  let rejectE1Events!: (err: Error) => void;
  let rejectE1Anchors!: (err: Error) => void;

  vi.mocked(endpoints.getJournal).mockImplementationOnce(
    () => new Promise((_res, rej) => { rejectE1Journal = rej; }) as never
  );
  vi.mocked(endpoints.listEvents).mockImplementationOnce(
    () => new Promise((_res, rej) => { rejectE1Events = rej; }) as never
  );
  vi.mocked(endpoints.getAnchors).mockImplementationOnce(
    () => new Promise((_res, rej) => { rejectE1Anchors = rej; }) as never
  );

  let entityId = 'e1';
  const { result, rerender } = renderHook(() => useExportData(entityId));

  entityId = 'e2';
  // e2 endpoints succeed (beforeEach mocks provide resolved values)
  rerender();

  // Reject ALL e1 fetches — wired correctly, not dead references.
  await act(async () => {
    rejectE1Journal(new Error('e1 network error'));
    rejectE1Events(new Error('e1 network error'));
    rejectE1Anchors(new Error('e1 network error'));
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
