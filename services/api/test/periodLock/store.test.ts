import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/store/db.js';
import { getPeriodLock, lockPeriod, reopenPeriod } from '../../src/periodLock/store.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0x1','0x2','0x3')").run();
});

it('absent period defaults to OPEN with reopenCount 0', () => {
  const r = getPeriodLock(db, 'e1', 'P1');
  expect(r.status).toBe('OPEN');
  expect(r.reopenCount).toBe(0);
});

it('lock persists status + immutable lights snapshot', () => {
  const r = lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{"je":"green"}', lockedBy: 'demo-controller', now: 1000 });
  expect(r.status).toBe('LOCKED');
  expect(r.lockedAt).toBe(1000);
  expect(r.lightsSnapshot).toBe('{"je":"green"}');
});

// WHY: locking an already-LOCKED period is an illegal transition; the CAS guard
// must reject it rather than silently overwrite the lock evidence.
it('lock on already-LOCKED throws ILLEGAL_TRANSITION', () => {
  lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 1 });
  expect(() => lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 2 })).toThrow(/ILLEGAL_TRANSITION/);
});

it('reopen flips to OPEN, bumps count, records restatement fields', () => {
  lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 1 });
  const r = reopenPeriod(db, { entityId: 'e1', periodId: 'P1', restatementReason: 'fix fx', reasonCode: 'ERROR_CORRECTION', affectedAmountEstimate: '500', wasAnchored: true, requestedBy: 'demo-controller', approvedBy: 'demo-controller', now: 2 });
  expect(r.status).toBe('OPEN');
  expect(r.reopenCount).toBe(1);
  expect(r.reasonCode).toBe('ERROR_CORRECTION');
  expect(r.wasAnchoredAtReopen).toBe(1);
});

it('reopen on OPEN throws ILLEGAL_TRANSITION', () => {
  expect(() => reopenPeriod(db, { entityId: 'e1', periodId: 'P1', restatementReason: 'x', reasonCode: 'OTHER', affectedAmountEstimate: null, wasAnchored: false, requestedBy: 'a', approvedBy: 'b', now: 1 })).toThrow(/ILLEGAL_TRANSITION/);
});
