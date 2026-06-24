// services/api/test/onboardingVerify.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { issueChallenge } from '../src/onboarding/challenge.js';
import { verifyOwnership } from '../src/onboarding/verify.js';
import { encodeOwnershipMessage } from '../src/onboarding/message.js';
import { listAttestations } from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

async function signFor(kp: Ed25519Keypair | Secp256k1Keypair, now = 1000) {
  const wallet = kp.toSuiAddress();
  const { nonce, expiresAt } = issueChallenge(db, E, wallet, now);
  const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
  const { signature } = await kp.signPersonalMessage(bytes);
  return { wallet, nonce, signature };
}

describe('verifyOwnership', () => {
  it('accepts a valid Ed25519 signature and writes an attestation', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
    expect(att.verifier).toBe('subledger-api/onboarding-verifier@v1');
    expect(att.initiatedBy).toBe('demo-operator');
    expect(listAttestations(db, E)).toHaveLength(1);
  });

  it('accepts a Secp256k1 signature (scheme-agnostic)', async () => {
    const kp = new Secp256k1Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
  });

  it('rejects a tampered signature → BAD_SIGNATURE, nonce not consumed', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const bad = signature.slice(0, -4) + 'AAAA';
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature: bad, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/BAD_SIGNATURE/);
    // nonce still open → a correct retry works
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
  });

  it('rejects a signature from a different key → ADDRESS_MISMATCH', async () => {
    const owner = new Ed25519Keypair();
    const attacker = new Ed25519Keypair();
    const wallet = owner.toSuiAddress();
    const { nonce, expiresAt } = issueChallenge(db, E, wallet, 1000);
    const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
    const { signature } = await attacker.signPersonalMessage(bytes); // attacker signs, claims owner's wallet
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/ADDRESS_MISMATCH/);
  });

  it('rejects replay of a consumed nonce → CHALLENGE_INVALID', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/CHALLENGE_INVALID/);
  });
});
