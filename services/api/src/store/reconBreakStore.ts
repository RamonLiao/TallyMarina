import type { Db } from './db.js';
import type { DispositionState } from '../exceptions/types.js';
import type { ReconReasonCode } from '../reconciliation/types.js';

export interface ReconBreakRow {
  entityId: string; periodId: string; wallet: string; coinType: string;
  state: DispositionState; reasonCode: ReconReasonCode; reasonNote: string | null;
  decidedBy: string; decidedAt: number;
}

function map(r: Record<string, unknown>): ReconBreakRow {
  return {
    entityId: r.entity_id as string, periodId: r.period_id as string,
    wallet: r.wallet as string, coinType: r.coin_type as string,
    state: r.state as DispositionState, reasonCode: r.reason_code as ReconReasonCode,
    reasonNote: (r.reason_note as string | null) ?? null,
    decidedBy: r.decided_by as string, decidedAt: r.decided_at as number,
  };
}

export function getReconDisposition(db: Db, entityId: string, periodId: string, wallet: string, coinType: string): ReconBreakRow | null {
  const r = db.prepare('SELECT * FROM recon_break_disposition WHERE entity_id=? AND period_id=? AND wallet=? AND coin_type=?')
    .get(entityId, periodId, wallet, coinType) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listReconDispositions(db: Db, entityId: string, periodId: string): ReconBreakRow[] {
  return (db.prepare('SELECT * FROM recon_break_disposition WHERE entity_id=? AND period_id=?').all(entityId, periodId) as Record<string, unknown>[]).map(map);
}

export function upsertReconDisposition(db: Db, row: ReconBreakRow): void {
  db.prepare(
    `INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, reason_note, decided_by, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_id, period_id, wallet, coin_type) DO UPDATE SET
       state=excluded.state, reason_code=excluded.reason_code, reason_note=excluded.reason_note,
       decided_by=excluded.decided_by, decided_at=excluded.decided_at`,
  ).run(row.entityId, row.periodId, row.wallet, row.coinType, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt);
}

export function appendReconDispositionLog(db: Db, row: ReconBreakRow, prevState: DispositionState | null): void {
  db.prepare(
    `INSERT INTO recon_break_disposition_log (entity_id, period_id, wallet, coin_type, prev_state, state, reason_code, reason_note, decided_by, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.entityId, row.periodId, row.wallet, row.coinType, prevState, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt);
}
