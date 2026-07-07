import type { Db } from '../store/db.js';
import { assertPeriodTransition, type PeriodStatus, type ReopenReasonCode } from './state.js';

export interface PeriodLockRow {
  entityId: string; periodId: string; status: PeriodStatus;
  lockedAt: number | null; lockedBy: string | null; lightsSnapshot: string | null;
  reopenedAt: number | null; reopenCount: number;
  restatementReason: string | null; reasonCode: ReopenReasonCode | null;
  affectedAmountEstimate: string | null;
  requestedBy: string | null; approvedBy: string | null;
}

function map(r: Record<string, unknown>): PeriodLockRow {
  return {
    entityId: r.entity_id as string, periodId: r.period_id as string, status: r.status as PeriodStatus,
    lockedAt: (r.locked_at as number | null) ?? null, lockedBy: (r.locked_by as string | null) ?? null,
    lightsSnapshot: (r.lights_snapshot as string | null) ?? null,
    reopenedAt: (r.reopened_at as number | null) ?? null, reopenCount: (r.reopen_count as number) ?? 0,
    restatementReason: (r.restatement_reason as string | null) ?? null,
    reasonCode: (r.reason_code as ReopenReasonCode | null) ?? null,
    affectedAmountEstimate: (r.affected_amount_estimate as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null, approvedBy: (r.approved_by as string | null) ?? null,
  };
}

export function getPeriodLock(db: Db, entityId: string, periodId: string): PeriodLockRow {
  const r = db.prepare('SELECT * FROM period_lock WHERE entity_id = ? AND period_id = ?').get(entityId, periodId) as Record<string, unknown> | undefined;
  if (r) return map(r);
  // Synthetic default — an un-touched period is OPEN.
  return {
    entityId, periodId, status: 'OPEN', lockedAt: null, lockedBy: null, lightsSnapshot: null,
    reopenedAt: null, reopenCount: 0, restatementReason: null, reasonCode: null,
    affectedAmountEstimate: null, requestedBy: null, approvedBy: null,
  };
}

export function lockPeriod(
  db: Db,
  a: { entityId: string; periodId: string; lightsSnapshot: string; lockedBy: string; now: number },
): PeriodLockRow {
  let out!: PeriodLockRow;
  db.transaction(() => {
    const cur = getPeriodLock(db, a.entityId, a.periodId);
    assertPeriodTransition(cur.status, 'lock'); // CAS: throws if not OPEN
    db.prepare(
      `INSERT INTO period_lock (entity_id, period_id, status, locked_at, locked_by, lights_snapshot, reopen_count)
       VALUES (?, ?, 'LOCKED', ?, ?, ?, ?)
       ON CONFLICT(entity_id, period_id) DO UPDATE SET
         -- reopen_count intentionally OMITTED: a re-lock after a reopen must PRESERVE the existing count, not reset it.
         -- lights_snapshot intentionally RE-SET on conflict: a new lock captures a fresh evidence snapshot;
         --   the CAS gate (assertPeriodTransition) already forbids locking a non-OPEN period.
         status='LOCKED', locked_at=excluded.locked_at, locked_by=excluded.locked_by, lights_snapshot=excluded.lights_snapshot`,
    ).run(a.entityId, a.periodId, a.now, a.lockedBy, a.lightsSnapshot, cur.reopenCount);
    out = getPeriodLock(db, a.entityId, a.periodId);
  })();
  return out;
}

export function reopenPeriod(
  db: Db,
  a: { entityId: string; periodId: string; restatementReason: string; reasonCode: ReopenReasonCode;
       affectedAmountEstimate: string | null; requestedBy: string; approvedBy: string; now: number },
): PeriodLockRow {
  let out!: PeriodLockRow;
  db.transaction(() => {
    const cur = getPeriodLock(db, a.entityId, a.periodId);
    assertPeriodTransition(cur.status, 'reopen'); // CAS: throws if not LOCKED
    db.prepare(
      `UPDATE period_lock SET status='OPEN', reopened_at=?, reopen_count=?, restatement_reason=?, reason_code=?,
         affected_amount_estimate=?, requested_by=?, approved_by=?
       WHERE entity_id=? AND period_id=?`,
    ).run(a.now, cur.reopenCount + 1, a.restatementReason, a.reasonCode, a.affectedAmountEstimate,
          a.requestedBy, a.approvedBy, a.entityId, a.periodId);
    out = getPeriodLock(db, a.entityId, a.periodId);
  })();
  return out;
}
