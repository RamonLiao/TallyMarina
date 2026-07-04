import type { Db } from './db.js';

export function appendRejectedEvent(
  db: Db,
  row: { entityId: string; periodId: string; eventTime: string; rawJson: string; reason: string },
): void {
  db.prepare(
    `INSERT INTO rejected_event_log (entity_id, period_id, event_time, raw_json, reason, rejected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.entityId, row.periodId, row.eventTime, row.rawJson, row.reason, new Date().toISOString());
}
