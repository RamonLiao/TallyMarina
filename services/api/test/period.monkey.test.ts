import { describe, it, expect, beforeEach } from 'vitest';
import { periodOf } from '@subledger/rules-engine';
import { openDb, type Db } from '../src/store/db.js';
import { ingestEvent, PeriodLockedError } from '../src/http/ingestEvent.js';
import { lockPeriod } from '../src/periodLock/store.js';
import { listPeriods } from '../src/store/periodQuery.js';
import { seedEntity } from './helpers.js';

const ENTITY_ID = 'acme-monkey';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  seedEntity(db, ENTITY_ID);
});

describe('period attribution — monkey (adversarial)', () => {
  it('boundary instants ±1ms around a quarter edge never mis-bin', () => {
    expect(periodOf('2026-03-31T23:59:59.999Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00.000Z')).toBe('2026-Q2');
  });

  it('leap day and year-end bin correctly', () => {
    expect(periodOf('2028-02-29T12:00:00Z')).toBe('2028-Q1');
    expect(periodOf('2026-12-31T23:59:59Z')).toBe('2026-Q4');
  });

  it('garbage / empty eventTime → INVALID_EVENT_TIME, never a null/silent bin', () => {
    for (const bad of ['', 'garbage', 'NaN', '2026-13-40T99:99Z']) {
      expect(() => periodOf(bad)).toThrow(/^INVALID_EVENT_TIME/);
    }
  });

  it('non-string eventTime (null, undefined, numeric) → INVALID_EVENT_TIME throws', () => {
    expect(() => periodOf(null as any)).toThrow(/^INVALID_EVENT_TIME/);
    expect(() => periodOf(undefined as any)).toThrow(/^INVALID_EVENT_TIME/);
    expect(() => periodOf(0 as any)).toThrow(/^INVALID_EVENT_TIME/);
  });

  it('far-future instant is a VALID date and must bin, not throw', () => {
    expect(periodOf('9999-01-01T00:00:00Z')).toBe('9999-Q1');
  });

  it('timezone-offset ISO string is binned by its UTC instant, not its local wall-clock date', () => {
    // 2026-03-31T23:00 in UTC-2 == 2026-04-01T01:00Z — must fall in Q2, not Q1,
    // even though the string's local calendar date reads "March 31".
    expect(periodOf('2026-03-31T23:00:00-02:00')).toBe('2026-Q2');
    // Symmetric case: a positive offset can pull an early-April instant back into Q1.
    expect(periodOf('2026-04-01T00:30:00+02:00')).toBe('2026-Q1'); // == 2026-03-31T22:30Z
  });

  it('whitespace-padded date string fails loud instead of silently misparsing', () => {
    expect(() => periodOf(' 2026-04-01T00:00:00Z ')).toThrow(/^INVALID_EVENT_TIME/);
  });

  it('a Date object and its equivalent ISO string bin identically', () => {
    const asString = periodOf('2026-04-01T00:00:00.000Z');
    const asDate = periodOf(new Date('2026-04-01T00:00:00.000Z'));
    expect(asDate).toBe(asString);
    expect(asDate).toBe('2026-Q2');
  });

  it('no event slips into a locked period across many ingest attempts', () => {
    lockPeriod(db, { entityId: ENTITY_ID, periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });

    let rejected = 0;
    for (let i = 0; i < 50; i++) {
      try {
        ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: `2026-0${(i % 3) + 1}-15T00:00:00Z` }));
      } catch (e) {
        if (e instanceof PeriodLockedError) rejected++;
      }
    }

    const inQ1 = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE entity_id = ? AND period_id = '2026-Q1'`).get(ENTITY_ID) as { n: number };
    expect(inQ1.n).toBe(0); // Q1 is locked: ZERO events ever landed there
    expect(rejected).toBeGreaterThan(0);

    const loggedRejections = db
      .prepare(`SELECT COUNT(*) AS n FROM rejected_event_log WHERE entity_id = ? AND period_id = '2026-Q1' AND reason = 'PERIOD_LOCKED_FOR_DATE'`)
      .get(ENTITY_ID) as { n: number };
    expect(loggedRejections.n).toBe(rejected); // every rejection is logged, none silently dropped
  });

  it('lock-then-ingest ordering: an ingest issued the instant after lock is still rejected (no race window)', () => {
    // Interleave real ingests into the target period both before and after the lock call
    // to make sure the CAS check inside ingestEvent, not test ordering, is what protects it.
    const beforeLock = ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-01-10T00:00:00Z' }));
    expect(beforeLock.periodId).toBe('2026-Q1');

    lockPeriod(db, { entityId: ENTITY_ID, periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });

    expect(() => ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: '2026-01-11T00:00:00Z' }))).toThrow(PeriodLockedError);

    const inQ1 = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE entity_id = ? AND period_id = '2026-Q1'`).get(ENTITY_ID) as { n: number };
    expect(inQ1.n).toBe(1); // only the pre-lock event, none post-lock
  });

  it('many distinct periods (40 quarters) enumerate without error via listPeriods', () => {
    for (let y = 2016; y < 2026; y++) {
      for (const m of ['02', '05', '08', '11']) {
        ingestEvent(db, ENTITY_ID, JSON.stringify({ eventTime: `${y}-${m}-01T00:00:00Z` }));
      }
    }
    const n = db.prepare(`SELECT COUNT(DISTINCT period_id) AS n FROM events WHERE entity_id = ?`).get(ENTITY_ID) as { n: number };
    expect(n.n).toBe(40);

    const periods = listPeriods(db, ENTITY_ID);
    expect(periods).toHaveLength(40);
    expect(periods.every((p) => typeof p.periodId === 'string' && /^\d{4}-Q[1-4]$/.test(p.periodId))).toBe(true);
    expect(periods.every((p) => p.lockStatus === 'OPEN')).toBe(true);
  });
});
