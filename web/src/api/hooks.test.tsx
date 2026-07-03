import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useEntities,
  useEvents,
  useReviewQueue,
  useJournal,
  useAnchors,
  useIngest,
  useClassify,
  useDecide,
  useRunRules,
  useConfirmAnchor,
  useDisposition,
  qk,
} from './hooks';
import * as endpoints from './endpoints';

// Stable entity fixture
const ENTITY_ID = 'acme:pilot-001';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

// --- Query hooks ---

it('useEntities loads entities via the endpoint fn', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([
    { id: ENTITY_ID, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
  ]);
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useEntities(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.at(0)?.id).toBe(ENTITY_ID);
});

it('useEvents is disabled when entityId is undefined', () => {
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useEvents(undefined), { wrapper });
  expect(result.current.fetchStatus).toBe('idle');
});

it('useEvents fetches when entityId is set', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([
    { id: 'evt-1', entityId: ENTITY_ID, status: 'INGESTED', normalized: {}, ai: null, final: null, routing: null },
  ]);
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useEvents(ENTITY_ID), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.at(0)?.id).toBe('evt-1');
});

it('useReviewQueue fetches events pending review', async () => {
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([
    { id: 'evt-2', entityId: ENTITY_ID, status: 'NEEDS_REVIEW', normalized: {}, ai: null, final: null, routing: 'NEEDS_REVIEW' },
  ]);
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useReviewQueue(ENTITY_ID), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.at(0)?.status).toBe('NEEDS_REVIEW');
});

it('useJournal fetches journal entries', async () => {
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useJournal(ENTITY_ID), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(Array.isArray(result.current.data)).toBe(true);
});

it('useAnchors fetches anchors', async () => {
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });
  const { wrapper } = makeWrapper();
  const { result } = renderHook(() => useAnchors(ENTITY_ID), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.anchors).toHaveLength(0);
});

// --- Mutation invalidation tests ---
// These tests assert WHY invalidation matters: after a write, stale query data
// must be refetched so the UI doesn't show outdated state.

it('useIngest invalidates events query on success', async () => {
  vi.spyOn(endpoints, 'ingest').mockResolvedValue({ ingested: 1, events: [] });
  const { qc, wrapper } = makeWrapper();
  const spy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useIngest(ENTITY_ID), { wrapper });
  await act(async () => { result.current.mutate(); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    queryKey: qk.events(ENTITY_ID),
  }));
});

it('useClassify invalidates events AND review-queue so the UI routing state is fresh', async () => {
  vi.spyOn(endpoints, 'classifyEvent').mockResolvedValue({
    event: { id: 'evt-1', entityId: ENTITY_ID, status: 'AUTO', normalized: {}, ai: null, final: null, routing: 'AUTO' },
    degraded: false,
  });
  const { qc, wrapper } = makeWrapper();
  const spy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useClassify(ENTITY_ID), { wrapper });
  await act(async () => { result.current.mutate('evt-1'); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
  expect(keys).toContainEqual(qk.events(ENTITY_ID));
  expect(keys).toContainEqual(qk.reviewQueue(ENTITY_ID));
});

it('useDecide invalidates events AND review-queue — stale review list would show already-decided items', async () => {
  vi.spyOn(endpoints, 'decide').mockResolvedValue({
    id: 'evt-1', entityId: ENTITY_ID, status: 'APPROVED', normalized: {}, ai: null, final: null, routing: null,
  });
  const { qc, wrapper } = makeWrapper();
  const spy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useDecide(ENTITY_ID), { wrapper });
  await act(async () => {
    result.current.mutate({ eventId: 'evt-1', finalEventType: 'TRANSFER', finalPurpose: 'vendor payment' });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
  expect(keys).toContainEqual(qk.events(ENTITY_ID));
  expect(keys).toContainEqual(qk.reviewQueue(ENTITY_ID));
});

it('useRunRules invalidates journal AND events — new JEs must appear immediately', async () => {
  vi.spyOn(endpoints, 'runRules').mockResolvedValue({ posted: 2, skipped: 0, journal: [] });
  const { qc, wrapper } = makeWrapper();
  const spy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useRunRules(ENTITY_ID), { wrapper });
  await act(async () => { result.current.mutate('2024-Q1'); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
  expect(keys).toContainEqual(qk.journal(ENTITY_ID));
  expect(keys).toContainEqual(qk.events(ENTITY_ID));
});

it('useDisposition invalidates exceptions AND triage-proposals — a manual disposition must clear a stale agent proposal badge', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  const { qc, wrapper } = makeWrapper();
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useDisposition(ENTITY_ID), { wrapper });
  await act(async () => {
    result.current.mutate({ exceptionId: 'RULES_FAILED:2', state: 'resolved', reasonCode: 'RECLASSIFIED' });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const keys = spy.mock.calls; // sanity: it actually hit the disposition endpoint
  expect(String(keys[0]![0])).toContain('/disposition');

  const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
  expect(invalidatedKeys).toContainEqual(['exceptions', ENTITY_ID]);
  expect(invalidatedKeys).toContainEqual(['triage-proposals', ENTITY_ID]);
});

it('useConfirmAnchor invalidates anchors — on-chain digest must be visible right after confirmation', async () => {
  vi.spyOn(endpoints, 'confirmAnchor').mockResolvedValue({
    id: 'anchor-1', snapshotId: 'snap-1', seq: 1,
    link: 'sui://x', digest: 'abc', explorerUrl: 'https://x', anchoredAt: '2024-01-01T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0,
  });
  const { qc, wrapper } = makeWrapper();
  const spy = vi.spyOn(qc, 'invalidateQueries');

  const { result } = renderHook(() => useConfirmAnchor(ENTITY_ID), { wrapper });
  await act(async () => {
    result.current.mutate({ snapshotId: 'snap-1', digest: 'abc', expectedSeq: 1 });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    queryKey: ['anchors', ENTITY_ID],
  }));
});
