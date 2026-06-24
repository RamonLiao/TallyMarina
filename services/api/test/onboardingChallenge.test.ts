import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { issueChallenge } from '../src/onboarding/challenge.js';
import { getOpenChallenge } from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

describe('issueChallenge', () => {
  it('issues a stored, retrievable nonce for ANY wallet (soft gate)', () => {
    const r = issueChallenge(db, E, '0xabc123', 1000);
    expect(r.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(r.expiresAt).toBe(1000 + 5 * 60 * 1000);
    expect(r.message).toContain(`nonce: ${r.nonce}`);
    expect(getOpenChallenge(db, E, r.wallet, r.nonce, 1000)).not.toBeNull();
  });

  it('throws ENTITY_NOT_FOUND for unknown entity', () => {
    expect(() => issueChallenge(db, 'nope', '0xw', 1000)).toThrow(/ENTITY_NOT_FOUND|no entity/i);
  });
});
