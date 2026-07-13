import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import { fetchJson } from './client';
import type { DispositionState, ExceptionsResponse, ProposalsResponse, ReasonCode } from './types';

export const qk = {
  entities: () => ['entities'] as const,
  events: (entityId: string) => ['events', entityId] as const,
  reviewQueue: (entityId: string) => ['review-queue', entityId] as const,
  journal: (entityId: string) => ['journal', entityId] as const,
  anchors: (entityId: string, key?: string) => ['anchors', entityId, key ?? null] as const,
};

// ---- Query hooks ----

export function useEntities() {
  return useQuery({ queryKey: qk.entities(), queryFn: api.listEntities });
}

export function useEvents(entityId: string | undefined) {
  return useQuery({
    queryKey: qk.events(entityId ?? ''),
    queryFn: () => api.listEvents(entityId!),
    enabled: !!entityId,
  });
}

export function useReviewQueue(entityId: string | undefined) {
  return useQuery({
    queryKey: qk.reviewQueue(entityId ?? ''),
    queryFn: () => api.reviewQueue(entityId!),
    enabled: !!entityId,
  });
}

export function useJournal(entityId: string | undefined) {
  return useQuery({
    queryKey: qk.journal(entityId ?? ''),
    queryFn: () => api.getJournal(entityId!),
    enabled: !!entityId,
  });
}

export function useAnchors(entityId: string | undefined, idempotencyKey?: string) {
  return useQuery({
    queryKey: qk.anchors(entityId ?? '', idempotencyKey),
    queryFn: () => api.getAnchors(entityId!, idempotencyKey),
    enabled: !!entityId,
  });
}

// ---- Reports: trial balance / roll-forward (Task 6/8) ----

export function useTrialBalance(entityId: string | undefined, periodId: string | undefined) {
  return useQuery({
    queryKey: ['trial-balance', entityId ?? '', periodId ?? ''],
    queryFn: () => api.getTrialBalance(entityId!, periodId!),
    enabled: !!entityId && !!periodId,
  });
}

export function useRollForward(entityId: string | undefined, periodId: string | undefined) {
  return useQuery({
    queryKey: ['roll-forward', entityId ?? '', periodId ?? ''],
    queryFn: () => api.getRollForward(entityId!, periodId!),
    enabled: !!entityId && !!periodId,
  });
}

// ---- Mutation hooks ----

export function useIngest(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ingest(entityId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.events(entityId) }),
  });
}

/**
 * classify is per-event (caller loops over events).
 * Invalidates events + review-queue so the UI reflects the new routing status.
 */
export function useClassify(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api.classifyEvent(eventId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.events(entityId) });
      qc.invalidateQueries({ queryKey: qk.reviewQueue(entityId) });
    },
  });
}

export function useCopilot() {
  return useMutation({ mutationFn: (eventId: string) => api.copilot(eventId) });
}

export function useDecide(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { eventId: string; finalEventType: string; finalPurpose: string }) =>
      api.decide(args.eventId, {
        finalEventType: args.finalEventType,
        finalPurpose: args.finalPurpose,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.events(entityId) });
      qc.invalidateQueries({ queryKey: qk.reviewQueue(entityId) });
      // A decide can change the CLASSIFY_REVIEW exception's underlying event and outrun a
      // still-`proposed` agent proposal on it (same reasoning as useDisposition).
      qc.invalidateQueries({ queryKey: ['exceptions', entityId] });
      qc.invalidateQueries({ queryKey: ['triage-proposals', entityId] });
    },
  });
}

export function useRunRules(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) => api.runRules(entityId, periodId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.journal(entityId) });
      qc.invalidateQueries({ queryKey: qk.events(entityId) });
    },
  });
}

export function useSnapshot(entityId: string) {
  return useMutation({
    mutationFn: (periodId: string) => api.snapshot(entityId, periodId),
  });
}

export function usePrepareAnchor(entityId: string) {
  return useMutation({
    mutationFn: (args: { snapshotId: string; walletAddress: string }) =>
      api.prepareAnchor(entityId, args),
  });
}

export function useConfirmAnchor(entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { snapshotId: string; digest: string; expectedSeq: number }) =>
      api.confirmAnchor(entityId, args),
    // Invalidate anchors so stale anchor list is refetched after on-chain confirmation
    onSuccess: () => qc.invalidateQueries({ queryKey: ['anchors', entityId] }),
  });
}

// ---- Exception Queue hooks ----

export function useExceptions(entityId: string | undefined, periodId = '2026-Q2') {
  return useQuery({
    queryKey: ['exceptions', entityId ?? '', periodId],
    queryFn: () =>
      fetchJson<ExceptionsResponse>(
        `/entities/${encodeURIComponent(entityId!)}/exceptions?periodId=${encodeURIComponent(periodId)}`,
      ),
    enabled: !!entityId,
  });
}

export function useDisposition(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { exceptionId: string; state: DispositionState; reasonCode: ReasonCode; reasonNote?: string; periodId?: string }) =>
      fetchJson(`/exceptions/${encodeURIComponent(v.exceptionId)}/disposition`, {
        method: 'POST',
        body: JSON.stringify({ state: v.state, reasonCode: v.reasonCode, reasonNote: v.reasonNote, ...(v.periodId !== undefined ? { periodId: v.periodId } : {}) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exceptions', entityId ?? ''] });
      // A manual disposition can outrun a still-`proposed` agent proposal on the same
      // exception; without this the list/detail keep showing the stale agent badge.
      qc.invalidateQueries({ queryKey: ['triage-proposals', entityId ?? ''] });
    },
  });
}

// ---- Triage agent hooks ----

export function useTriageProposals(entityId: string | undefined) {
  return useQuery({
    queryKey: ['triage-proposals', entityId ?? ''],
    queryFn: () => fetchJson<ProposalsResponse>(`/entities/${encodeURIComponent(entityId!)}/triage/proposals`),
    enabled: !!entityId,
  });
}

function invalidateTriage(qc: ReturnType<typeof useQueryClient>, entityId: string | undefined) {
  qc.invalidateQueries({ queryKey: ['triage-proposals', entityId ?? ''] });
  qc.invalidateQueries({ queryKey: ['exceptions', entityId ?? ''] });
}

export function useAcceptProposal(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: number) =>
      fetchJson(`/triage/proposals/${proposalId}/accept`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => invalidateTriage(qc, entityId),
    onError: () => invalidateTriage(qc, entityId), // 409 stale → refresh so the card disappears
  });
}

export function useRejectProposal(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { proposalId: number; note?: string }) =>
      fetchJson(`/triage/proposals/${v.proposalId}/reject`, { method: 'POST', body: JSON.stringify({ note: v.note }) }),
    onSuccess: () => invalidateTriage(qc, entityId),
    onError: () => invalidateTriage(qc, entityId), // 409 stale → refresh so the card disappears
  });
}
