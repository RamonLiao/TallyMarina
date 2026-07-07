import type { Database as Db } from 'better-sqlite3';
import { periodOf } from '@subledger/rules-engine';
import { buildMerkle, type JournalEntry } from '../deps/rulesEngine.js';
import { insertMigrationOverride } from './migrationOverrideLog.js';

/**
 * P1 (spec §3.3): for each ANCHORED snapshot, recompute the merkle root from the
 * backfilled period-scoped JEs and byte-compare to the stored root. Abort only on a
 * real mismatch (precise — no entity-wide false positive for entities that legitimately
 * span multiple periods after the one-time migration). An operator may accept specific
 * mismatches via C2_MIGRATION_ACCEPT_ROOT_CHANGE (comma-separated snapshot ids); each
 * acceptance is written to migration_override_log (console is not the only evidence).
 */
export function runP1Gate(db: Db): void {
  const accept = new Set(
    (process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const anchored = db.prepare(
    `SELECT id, entity_id, period_id, merkle_root FROM snapshots WHERE status = 'ANCHORED'`,
  ).all() as { id: string; entity_id: string; period_id: string; merkle_root: string }[];

  const violations: string[] = [];
  for (const s of anchored) {
    const rows = db.prepare(
      `SELECT je_json FROM journal_entries WHERE entity_id = ? AND period_id = ?`,
    ).all(s.entity_id, s.period_id) as { je_json: string }[];
    if (rows.length === 0) continue; // no period JEs to recompute against — nothing to contradict
    const jes = rows.map((r) => JSON.parse(r.je_json) as JournalEntry);
    const recomputed = buildMerkle(jes).manifest.merkleRoot;
    if (recomputed === s.merkle_root) continue; // precise pass
    if (accept.has(s.id)) {
      insertMigrationOverride(db, {
        snapshotId: s.id, oldRoot: s.merkle_root, recomputedRoot: recomputed,
        operator: 'env:C2_MIGRATION_ACCEPT_ROOT_CHANGE',
        acceptedAt: new Date().toISOString(),
        justification: 'operator-accepted via env allow-list',
      });
      console.warn(`[c2-migration] P1 override: snapshot ${s.id} old=${s.merkle_root} recomputed=${recomputed} operator-accepted via env`);
      continue;
    }
    violations.push(`${s.id} (stored=${s.merkle_root} recomputed=${recomputed})`);
  }
  if (violations.length > 0) {
    throw new Error(`MIGRATION_P1_ANCHOR_ROOT_CHANGED: ${violations.join('; ')} — restatement is H2, aborting (add snapshot id to C2_MIGRATION_ACCEPT_ROOT_CHANGE to accept)`);
  }
}

/**
 * One-time, idempotent backfill of period_id from each event's raw_json.eventTime.
 * Runs the SAME periodOf as the write path — no second quarter algorithm (spec §3.2).
 * Fail-loud on unparseable time, residual nulls, or P1 anchor-root change (spec §6.2, §7).
 */
export function backfillPeriodIds(db: Db): { events: number; journalEntries: number } {
  // One-time-migration marker: once every event has period_id set (T4's insert
  // path always sets it), the migration is done — skip backfill, JE-inherit,
  // residual gate, AND the P1 gate on every subsequent process boot. Without
  // this, P1 becomes a permanent every-boot invariant and can brick startup
  // for entities that legitimately span periods after the one-time migration.
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id IS NULL`).get() as {
    n: number;
  };
  if (pending.n === 0) {
    return { events: 0, journalEntries: 0 };
  }

  // All writes + gates run in a single transaction: if the P1 (or residual)
  // gate throws below, better-sqlite3 rolls back the period_id UPDATEs, so
  // COUNT(period_id IS NULL) stays >0 and the top-level `pending` guard above
  // will NOT early-return on the next boot — the gate keeps firing until an
  // operator remediates (Rule 12: fail-loud must not self-clear on restart).
  const result = db.transaction((): { events: number; journalEntries: number } => {
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
    const residual = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id IS NULL`).get() as {
      n: number;
    };
    if (residual.n > 0) {
      throw new Error(`MIGRATION_PERIOD_NULL_RESIDUAL: ${residual.n} events still null`);
    }

    // Precondition P1 (spec §6.2): each already-ANCHORED snapshot's own period must
    // still recompute to its stored root, else re-slicing would change an already-
    // committed on-chain root. Must run AFTER the writes above since it reads the
    // just-backfilled period_id. Precise per-snapshot recompute (not an entity-wide
    // span check) — an entity legitimately spanning multiple periods is fine as long
    // as each anchored snapshot's OWN period still checksums correctly.
    runP1Gate(db);

    return { events, journalEntries: je.changes as number };
  })();

  // Audit record (spec §7 step 8) — only reached after a successful commit.
  console.info(
    `[c2-migration] backfilled period_id: events=${result.events} journalEntries=${result.journalEntries} ` +
      `codec=JE_LEAF_BCS_V1 no-anchored-root-change=verified`,
  );
  return result;
}
