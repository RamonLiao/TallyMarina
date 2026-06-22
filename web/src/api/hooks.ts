import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';

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
