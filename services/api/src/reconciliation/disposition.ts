// AUDIT OVERLAY ONLY. No journal writes — recon disposition is triage metadata.
import type { Db } from '../store/db.js';
import type { DispositionState } from '../exceptions/types.js';
import { assertDispositionTransition } from '../exceptions/disposition.js';
import type { ReconReasonCode } from './types.js';
import { getReconDisposition, upsertReconDisposition, appendReconDispositionLog, type ReconBreakRow } from '../store/reconBreakStore.js';

export interface ApplyReconArgs {
  entityId: string; periodId: string; wallet: string; coinType: string;
  to: DispositionState; reasonCode: ReconReasonCode; reasonNote?: string | null;
  decidedBy: string; now: number;
}

export function applyReconDisposition(db: Db, args: ApplyReconArgs): ReconBreakRow {
  let result!: ReconBreakRow;
  db.transaction(() => {
    const current = getReconDisposition(db, args.entityId, args.periodId, args.wallet, args.coinType);
    const from: DispositionState = current?.state ?? 'open';
    assertDispositionTransition(from, args.to); // reuse Exception transition graph
    const row: ReconBreakRow = {
      entityId: args.entityId, periodId: args.periodId, wallet: args.wallet, coinType: args.coinType,
      state: args.to, reasonCode: args.reasonCode, reasonNote: args.reasonNote ?? null,
      decidedBy: args.decidedBy, decidedAt: args.now,
    };
    upsertReconDisposition(db, row);
    appendReconDispositionLog(db, row, current?.state ?? null);
    result = row;
  })();
  return result;
}
