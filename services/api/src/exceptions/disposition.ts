// AUDIT OVERLAY ONLY. No journal writes permitted — disposition is triage metadata only.
import type { Db } from '../store/db.js';
import type { DispositionState, DispositionSource, ReasonCode } from './types.js';
import { getDisposition, upsertDisposition, appendDispositionLog, type DispositionRow } from '../store/dispositionStore.js';

const LEGAL: Record<DispositionState, DispositionState[]> = {
  open: ['resolved', 'dismissed', 'deferred'],
  deferred: ['open', 'resolved', 'dismissed'],
  resolved: [],   // terminal
  dismissed: [],  // terminal
};

export function assertDispositionTransition(from: DispositionState, to: DispositionState): void {
  if (!LEGAL[from]?.includes(to)) {
    throw new Error(`ILLEGAL_TRANSITION: ${from} → ${to}`);
  }
}

export interface ApplyArgs {
  entityId: string; category: string; eventId: string;
  to: DispositionState; reasonCode: ReasonCode; reasonNote?: string | null;
  decidedBy: string; now: number;
  source?: DispositionSource; proposalId?: number | null;
}

export function applyDisposition(db: Db, args: ApplyArgs): DispositionRow {
  let result!: DispositionRow;
  db.transaction(() => {
    // Re-read inside transaction so the transition check is race-free.
    const current = getDisposition(db, args.category, args.eventId);
    const from: DispositionState = current?.state ?? 'open';
    assertDispositionTransition(from, args.to);
    const row: DispositionRow = {
      category: args.category,
      eventId: args.eventId,
      entityId: args.entityId,
      state: args.to,
      reasonCode: args.reasonCode,
      reasonNote: args.reasonNote ?? null,
      decidedBy: args.decidedBy,
      decidedAt: args.now,
      source: args.source ?? 'HUMAN',
      proposalId: args.proposalId ?? null,
    };
    upsertDisposition(db, row);
    appendDispositionLog(db, row);
    result = row;
  })();
  return result;
}
