import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { backfillPeriodIds } from '../src/store/backfillPeriod';

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, entity_id TEXT, raw_json TEXT, status TEXT, period_id TEXT);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, entity_id TEXT, event_id TEXT, je_json TEXT, idempotency_key TEXT, leaf_hash TEXT, period_id TEXT);
    CREATE TABLE snapshots (id TEXT, entity_id TEXT, period_id TEXT, merkle_root TEXT, status TEXT);
  `);
  db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, 'INGESTED')`)
    .run('e1', 'acme', JSON.stringify({ eventTime: '2026-02-10T00:00:00Z' }));
  db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, 'INGESTED')`)
    .run('e2', 'acme', JSON.stringify({ eventTime: '2026-05-10T00:00:00Z' }));
  db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j1','acme','e1','{}','k1','h1')`).run();
  return db;
}

describe('backfillPeriodIds', () => {
  it('sets period_id from eventTime on events and inherits to JEs', () => {
    const db = legacyDb();
    backfillPeriodIds(db as any);
    const e1 = db.prepare(`SELECT period_id FROM events WHERE id='e1'`).get() as { period_id: string };
    const e2 = db.prepare(`SELECT period_id FROM events WHERE id='e2'`).get() as { period_id: string };
    const j1 = db.prepare(`SELECT period_id FROM journal_entries WHERE id='j1'`).get() as { period_id: string };
    expect(e1.period_id).toBe('2026-Q1');
    expect(e2.period_id).toBe('2026-Q2');
    expect(j1.period_id).toBe('2026-Q1'); // inherited from source event e1
  });

  it('is idempotent — only fills nulls', () => {
    const db = legacyDb();
    backfillPeriodIds(db as any);
    const again = backfillPeriodIds(db as any);
    expect(again.events).toBe(0);
  });

  it('aborts fail-loud when an event has unparseable eventTime', () => {
    const db = legacyDb();
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('bad','acme','{"eventTime":"garbage"}','INGESTED')`).run();
    expect(() => backfillPeriodIds(db as any)).toThrow(/INVALID_EVENT_TIME/);
  });

  it('P1 gate: aborts when an anchored entity spans 2 distinct periods', () => {
    const db = legacyDb(); // e1=Q1, e2=Q2 for entity 'acme', both period_id NULL
    db.prepare(`INSERT INTO snapshots (id, entity_id, period_id, merkle_root, status) VALUES ('s1','acme',NULL,'root1','ANCHORED')`).run();
    expect(() => backfillPeriodIds(db as any)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
  });

  it('P1 gate: passes when an anchored entity has events in a single period', () => {
    const db = legacyDb();
    // Remove the cross-period event so 'acme' only has e1 (Q1).
    db.prepare(`DELETE FROM events WHERE id = 'e2'`).run();
    db.prepare(`INSERT INTO snapshots (id, entity_id, period_id, merkle_root, status) VALUES ('s1','acme',NULL,'root1','ANCHORED')`).run();
    const result = backfillPeriodIds(db as any);
    expect(result.events).toBe(1);
    const e1 = db.prepare(`SELECT period_id FROM events WHERE id='e1'`).get() as { period_id: string };
    expect(e1.period_id).toBe('2026-Q1');
  });

  it('P1 gate failure rolls back period_id writes so the gate keeps firing on every reboot (NEW-1 fix)', () => {
    const db = legacyDb(); // e1=Q1, e2=Q2 for entity 'acme', both period_id NULL
    db.prepare(`INSERT INTO snapshots (id, entity_id, period_id, merkle_root, status) VALUES ('s1','acme',NULL,'root1','ANCHORED')`).run();

    // Boot 1: P1 gate throws.
    expect(() => backfillPeriodIds(db as any)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);

    // The backfill UPDATEs must have been rolled back with the gate failure —
    // NOT committed ahead of the throw. Pre-fix, each UPDATE auto-committed
    // outside a transaction, so this would read 0 instead of 2.
    const residual = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id IS NULL`).get() as {
      n: number;
    };
    expect(residual.n).toBe(2);

    // Boot 2: because period_id is still NULL for both events, the top-level
    // `pending` guard does NOT early-return, so P1 must run and throw again —
    // the gate must not silently self-clear on restart.
    expect(() => backfillPeriodIds(db as any)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
  });

  it('one-time skip: once migrated, the gate is dormant on every subsequent boot (Critical fix)', () => {
    const db = legacyDb();
    // First boot: successful migration, no anchored entities yet.
    const first = backfillPeriodIds(db as any);
    expect(first.events).toBe(2);

    // Simulate a later boot: entity now has an ANCHORED snapshot and a new
    // second-period event, WITHOUT nulling existing period_ids. Pre-fix, the
    // P1 gate would run again on every boot and throw here, bricking the API
    // process on restart. Post-fix, period_id is already fully populated so
    // the migration marker (COUNT WHERE period_id IS NULL = 0) short-circuits
    // the whole block before P1 ever runs.
    db.prepare(`INSERT INTO snapshots (id, entity_id, period_id, merkle_root, status) VALUES ('s1','acme','2026-Q1','root1','ANCHORED')`).run();
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status, period_id) VALUES ('e3','acme',?, 'INGESTED', '2026-Q3')`)
      .run(JSON.stringify({ eventTime: '2026-08-01T00:00:00Z' }));

    const second = backfillPeriodIds(db as any);
    expect(second).toEqual({ events: 0, journalEntries: 0 });
  });
});
