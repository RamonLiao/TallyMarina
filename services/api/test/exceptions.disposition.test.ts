import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { applyDisposition, assertDispositionTransition } from '../src/exceptions/disposition.js';
import { getDisposition } from '../src/store/dispositionStore.js';

function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  insertEvent(db, { id: 'ev1', entityId: 'e1', rawJson: '{}' });
  insertEvent(db, { id: 'ev2', entityId: 'e1', rawJson: '{}' });
  return db;
}
const base = (over: object) => ({ entityId: 'e1', category: 'CLASSIFY_REVIEW', eventId: 'ev1', reasonCode: 'RECLASSIFIED' as const, decidedBy: 'tester', now: 1000, ...over });

describe('disposition state machine', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('open → resolved/dismissed/deferred are legal', () => {
    for (const to of ['resolved', 'dismissed', 'deferred'] as const) {
      expect(() => assertDispositionTransition('open', to)).not.toThrow();
    }
  });

  it('rejects terminal re-open (resolved → open)', () => {
    expect(() => assertDispositionTransition('resolved', 'open')).toThrow(/ILLEGAL_TRANSITION/);
    expect(() => assertDispositionTransition('dismissed', 'open')).toThrow(/ILLEGAL_TRANSITION/);
  });

  it('deferred → resolved is legal; applyDisposition persists + logs', () => {
    applyDisposition(db, base({ to: 'deferred' }) as never);
    const r = applyDisposition(db, base({ to: 'resolved' }) as never);
    expect(r.state).toBe('resolved');
    expect(getDisposition(db, 'CLASSIFY_REVIEW', 'ev1')!.state).toBe('resolved');
    const log = db.prepare('SELECT count(*) c FROM exception_disposition_log').get() as { c: number };
    expect(log.c).toBe(2); // append-only: both transitions retained
  });

  it('composite key isolates two categories on the same event', () => {
    applyDisposition(db, base({ category: 'CLASSIFY_REVIEW', to: 'resolved' }) as never);
    applyDisposition(db, base({ category: 'RULES_FAILED', to: 'deferred' }) as never);
    expect(getDisposition(db, 'CLASSIFY_REVIEW', 'ev1')!.state).toBe('resolved');
    expect(getDisposition(db, 'RULES_FAILED', 'ev1')!.state).toBe('deferred');
  });

  it('rejects illegal transition through applyDisposition', () => {
    applyDisposition(db, base({ to: 'resolved' }) as never);
    expect(() => applyDisposition(db, base({ to: 'deferred' }) as never)).toThrow(/ILLEGAL_TRANSITION/);
  });
});
