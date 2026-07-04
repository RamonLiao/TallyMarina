import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { ingestEvent, PeriodLockedError } from '../src/http/ingestEvent.js';
import { lockPeriod } from '../src/periodLock/store.js';
import { listPeriods } from '../src/store/periodQuery.js';
import { seedEntity } from './helpers.js';

const ENTITY_ID = 'acme-demo';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  seedEntity(db, ENTITY_ID);
});

// WHY: this is the literal cross-quarter demo script — lock Q1, prove a Q1-dated
// ingest is rejected (409-equivalent PERIOD_LOCKED_FOR_DATE) while a Q2-dated
// ingest still succeeds (201-equivalent). If this regresses, the headline demo
// story is broken even though the underlying gate/period-attribution units pass.
describe('cross-quarter cutoff-reject demo script', () => {
  it('locks Q1, rejects a Q1-dated ingest, and still accepts a Q2-dated ingest', () => {
    const q1 = ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }));
    expect(q1.periodId).toBe('2026-Q1');

    const q2 = ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }));
    expect(q2.periodId).toBe('2026-Q2');

    const periods = listPeriods(db, ENTITY_ID).map((p) => p.periodId);
    expect(periods).toContain('2026-Q1');
    expect(periods).toContain('2026-Q2');

    lockPeriod(db, { entityId: ENTITY_ID, periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });

    let err: unknown;
    try {
      ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-03-15T00:00:00Z' }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PeriodLockedError);
    expect((err as PeriodLockedError).periodId).toBe('2026-Q1');

    const q2Again = ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-06-15T00:00:00Z' }));
    expect(q2Again.periodId).toBe('2026-Q2');
  });
});
