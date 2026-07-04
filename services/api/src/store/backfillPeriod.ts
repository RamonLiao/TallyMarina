import type { Database as Db } from 'better-sqlite3';
import { periodOf } from '@subledger/rules-engine';

/**
 * One-time, idempotent backfill of period_id from each event's raw_json.eventTime.
 * Runs the SAME periodOf as the write path — no second quarter algorithm (spec §3.2).
 * Fail-loud on unparseable time, residual nulls, or P1 anchor-root change (spec §6.2, §7).
 */
export function backfillPeriodIds(db: Db): { events: number; journalEntries: number } {
  const nullEvents = db
    .prepare(`SELECT id, raw_json FROM events WHERE period_id IS NULL`)
    .all() as { id: string; raw_json: string }[];

  const setEvent = db.prepare(`UPDATE events SET period_id = ? WHERE id = ?`);
  let events = 0;
  for (const row of nullEvents) {
    let eventTime: string;
    try {
      eventTime = (JSON.parse(row.raw_json) as { eventTime: string }).eventTime;
    } catch {
      throw new Error(`INVALID_EVENT_TIME: event ${row.id} has unparseable raw_json`);
    }
    const pid = periodOf(eventTime); // throws INVALID_EVENT_TIME on bad time
    setEvent.run(pid, row.id);
    events++;
  }

  // JEs inherit from their source event.
  const je = db
    .prepare(
      `UPDATE journal_entries
         SET period_id = (SELECT e.period_id FROM events e WHERE e.id = journal_entries.event_id)
       WHERE period_id IS NULL`,
    )
    .run();

  // Verification gate: zero residual nulls on events.
  const residual = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id IS NULL`).get() as { n: number };
  if (residual.n > 0) {
    throw new Error(`MIGRATION_PERIOD_NULL_RESIDUAL: ${residual.n} events still null`);
  }

  // Precondition P1 (spec §6.2): no already-anchored entity may span >1 period,
  // else re-slicing would change an already-committed on-chain root.
  const anchoredMultiPeriod = db
    .prepare(
      `SELECT s.entity_id, COUNT(DISTINCT e.period_id) AS periods
         FROM snapshots s
         JOIN events e ON e.entity_id = s.entity_id
        WHERE s.status = 'ANCHORED'
        GROUP BY s.entity_id
       HAVING periods > 1`,
    )
    .all() as { entity_id: string; periods: number }[];
  if (anchoredMultiPeriod.length > 0) {
    throw new Error(
      `MIGRATION_P1_ANCHOR_ROOT_CHANGED: anchored entities span multiple periods: ${anchoredMultiPeriod
        .map((r) => r.entity_id)
        .join(',')} — restatement is H2, aborting`,
    );
  }

  // Audit record (spec §7 step 8).
  console.info(
    `[c2-migration] backfilled period_id: events=${events} journalEntries=${je.changes} ` +
      `codec=JE_LEAF_BCS_V1 no-anchored-root-change=verified`,
  );
  return { events, journalEntries: je.changes as number };
}
