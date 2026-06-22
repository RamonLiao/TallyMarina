export type EventStatus = 'INGESTED' | 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'POSTED';
export type SnapshotStatus = 'DRAFT' | 'FROZEN' | 'ANCHORED';

export class StateError extends Error {
  readonly code = 'ILLEGAL_TRANSITION' as const;
  constructor(public readonly from: string, public readonly to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
    this.name = 'StateError';
  }
}

// classify writes AUTO|NEEDS_REVIEW from INGESTED; decide -> APPROVED; run-rules -> POSTED.
const EVENT_LEGAL: Record<EventStatus, EventStatus[]> = {
  INGESTED: ['AUTO', 'NEEDS_REVIEW'],
  AUTO: ['POSTED'],
  NEEDS_REVIEW: ['APPROVED'],
  APPROVED: ['POSTED'],
  POSTED: [],
};

const SNAPSHOT_LEGAL: Record<SnapshotStatus, SnapshotStatus[]> = {
  DRAFT: ['FROZEN'],
  FROZEN: ['ANCHORED'],
  ANCHORED: [],
};

export function assertEventTransition(from: EventStatus, to: EventStatus): void {
  if (!EVENT_LEGAL[from].includes(to)) throw new StateError(from, to);
}

export function assertSnapshotTransition(from: SnapshotStatus, to: SnapshotStatus): void {
  if (!SNAPSHOT_LEGAL[from].includes(to)) throw new StateError(from, to);
}
