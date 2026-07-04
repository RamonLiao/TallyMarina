import type { Database as Db } from 'better-sqlite3';
import { getPeriodLock } from '../periodLock/store.js';

export function listPeriods(db: Db, entityId: string): { periodId: string; lockStatus: 'OPEN' | 'LOCKED' }[] {
  const rows = db
    .prepare(`SELECT DISTINCT period_id AS periodId FROM events WHERE entity_id = ? ORDER BY period_id ASC`)
    .all(entityId) as { periodId: string }[];
  return rows.map((r) => ({
    periodId: r.periodId,
    lockStatus: getPeriodLock(db, entityId, r.periodId).status === 'LOCKED' ? 'LOCKED' : 'OPEN',
  }));
}
