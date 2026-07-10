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

// The only two states in which a human has actually decided the item: `resolved` means a
// correcting entry exists, `dismissed` means someone accepted it under a reason code. Everything
// else — `open`, `deferred`, no disposition row, and any state added after this line was written
// — leaves the item undecided, and a period cannot be closed over an undecided item.
//
// Deliberately an allow-list: the previous `d === null || d.state === 'open'` form was a deny-list
// and therefore let `deferred` (and any future state) through the close gate by omission.
const CLOSE_CLEARING_STATES: readonly DispositionState[] = ['resolved', 'dismissed'];

/** Single source of truth for "does this disposition stop the period from closing?" */
export function blocksClose(d: { state: DispositionState } | null): boolean {
  return d === null || !CLOSE_CLEARING_STATES.includes(d.state);
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
