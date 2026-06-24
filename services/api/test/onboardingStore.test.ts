// services/api/test/onboardingStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertChallenge, getOpenChallenge, consumeChallenge,
  insertAttestation, listAttestations, latestAttestation,
} from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

describe('onboardingStore', () => {
  it('getOpenChallenge returns only non-consumed, non-expired', () => {
    insertChallenge(db, { entityId: E, wallet: '0xw', nonce: 'n1', expiresAt: 1000, consumedAt: null, createdAt: 0 });
    expect(getOpenChallenge(db, E, '0xw', 'n1', 999)?.nonce).toBe('n1');
    expect(getOpenChallenge(db, E, '0xw', 'n1', 1001)).toBeNull(); // expired
  });

  it('consumeChallenge is atomic single-use', () => {
    insertChallenge(db, { entityId: E, wallet: '0xw', nonce: 'n2', expiresAt: 1000, consumedAt: null, createdAt: 0 });
    expect(consumeChallenge(db, E, '0xw', 'n2', 500)).toBe(true);
    expect(consumeChallenge(db, E, '0xw', 'n2', 500)).toBe(false); // already used
    expect(getOpenChallenge(db, E, '0xw', 'n2', 500)).toBeNull();
  });

  it('attestation append + latest by wallet', () => {
    const base = { entityId: E, wallet: '0xw', nonce: 'n3', verifier: 'v', initiatedBy: 'op', messageSnapshot: 'm', templateVersion: 'v1', connectedAccount: '0xw' };
    insertAttestation(db, { ...base, id: 'a1', verifiedAt: 100 });
    insertAttestation(db, { ...base, id: 'a2', nonce: 'n4', verifiedAt: 200 });
    expect(listAttestations(db, E)).toHaveLength(2);
    expect(latestAttestation(db, E, '0xw')?.id).toBe('a2');
  });
});
