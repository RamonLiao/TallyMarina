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
});
