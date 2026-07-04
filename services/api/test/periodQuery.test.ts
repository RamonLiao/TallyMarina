import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { lockPeriod } from '../src/periodLock/store.js';
import { listPeriods } from '../src/store/periodQuery.js';

describe('listPeriods', () => {
  it('returns distinct periods ascending with lock status', () => {
    const db = openDb(':memory:');
    insertEntity(db, { id: 'acme', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    insertEvent(db, { id: 'a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(db, { id: 'b', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    lockPeriod(db, { entityId: 'acme', periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });
    const out = listPeriods(db, 'acme');
    expect(out).toEqual([
      { periodId: '2026-Q1', lockStatus: 'LOCKED' },
      { periodId: '2026-Q2', lockStatus: 'OPEN' },
    ]);
  });
});
