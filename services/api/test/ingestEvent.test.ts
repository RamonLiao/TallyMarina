import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { ingestEvent, PeriodLockedError } from '../src/http/ingestEvent.js';
import { lockPeriod } from '../src/periodLock/store.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare(
    "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme','ACME','0x1','0x2','0x3')",
  ).run();
});

describe('ingestEvent gate', () => {
  it('inserts an event into an OPEN period', () => {
    const r = ingestEvent(db, 'acme', JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }));
    expect(r.periodId).toBe('2026-Q2');
    const row = db.prepare(`SELECT period_id FROM events WHERE id=?`).get(r.eventId) as { period_id: string };
    expect(row.period_id).toBe('2026-Q2');
  });

  // WHY: a LOCKED period must be immutable — an ingest into it must be refused AND
  // recorded in the audit trail, never silently dropped.
  it('rejects + logs an event dated into a LOCKED period, without inserting', () => {
    lockPeriod(db, { entityId: 'acme', periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });
    let err: any;
    try {
      ingestEvent(db, 'acme', JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }));
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PeriodLockedError);
    expect(err.periodId).toBe('2026-Q1');
    const inserted = db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
    expect(inserted.n).toBe(0); // not inserted
    const logged = db.prepare(`SELECT period_id, event_time FROM rejected_event_log`).get() as { period_id: string; event_time: string };
    expect(logged.period_id).toBe('2026-Q1'); // logged, not silently dropped
    expect(logged.event_time).toBe('2026-02-01T00:00:00Z');
  });

  // WHY (T4 review gap): rawJson missing the eventTime key entirely must fail loud
  // with INVALID_EVENT_TIME, not silently coerce to some default period.
  it('throws INVALID_EVENT_TIME when rawJson has no eventTime key', () => {
    expect(() => ingestEvent(db, 'acme', JSON.stringify({ foo: 'bar' }))).toThrow(/INVALID_EVENT_TIME/);
    const inserted = db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
    expect(inserted.n).toBe(0);
  });

  // WHY: the optional `id` param (Task 12) exists ONLY for the seeder. Every other caller must
  // let the gate mint a random uuid id. If someone deletes the `id ?? …` fallback (e.g. `id!`),
  // a no-id caller would insert `undefined`/NULL as the primary key — this pins that the default
  // is a real `evt-<uuid>`.
  it('mints an evt-<uuid> id when no id is supplied', () => {
    const r = ingestEvent(db, 'acme', JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }));
    expect(r.eventId).toMatch(/^evt-[0-9a-f-]{36}$/);
  });

  // WHY: a caller-supplied id that collides must throw on the PRIMARY KEY, never silently
  // overwrite an existing event or auto-rename to route around immutability. The seeder relies
  // on this being loud — a duplicated fixture id is a fixture bug, not something to smooth over.
  it('a duplicate caller-supplied id throws (PK collision), never overwrites', () => {
    const raw = JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' });
    ingestEvent(db, 'acme', raw, 'evt-fixed');
    expect(() => ingestEvent(db, 'acme', raw, 'evt-fixed')).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n;
    expect(n).toBe(1); // second call did not insert a second row
  });
});
