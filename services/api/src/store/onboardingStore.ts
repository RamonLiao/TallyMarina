// services/api/src/store/onboardingStore.ts
import type { Db } from './db.js';

export interface ChallengeRow {
  entityId: string; wallet: string; nonce: string;
  expiresAt: number; consumedAt: number | null; createdAt: number;
}
export interface AttestationRow {
  id: string; entityId: string; wallet: string; nonce: string;
  verifier: string; initiatedBy: string; messageSnapshot: string;
  templateVersion: string; connectedAccount: string; verifiedAt: number;
}

export function insertChallenge(db: Db, c: ChallengeRow): void {
  db.prepare(
    `INSERT INTO onboarding_challenge (entity_id, wallet, nonce, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(c.entityId, c.wallet, c.nonce, c.expiresAt, c.consumedAt, c.createdAt);
}

export function getOpenChallenge(db: Db, entityId: string, wallet: string, nonce: string, now: number): ChallengeRow | null {
  const r = db.prepare(
    `SELECT * FROM onboarding_challenge
     WHERE entity_id = ? AND wallet = ? AND nonce = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).get(entityId, wallet, nonce, now) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    entityId: r.entity_id as string, wallet: r.wallet as string, nonce: r.nonce as string,
    expiresAt: r.expires_at as number, consumedAt: (r.consumed_at as number | null) ?? null, createdAt: r.created_at as number,
  };
}

export function consumeChallenge(db: Db, entityId: string, wallet: string, nonce: string, now: number): boolean {
  const info = db.prepare(
    `UPDATE onboarding_challenge SET consumed_at = ?
     WHERE entity_id = ? AND wallet = ? AND nonce = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).run(now, entityId, wallet, nonce, now);
  return info.changes === 1;
}

function mapAtt(r: Record<string, unknown>): AttestationRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, wallet: r.wallet as string, nonce: r.nonce as string,
    verifier: r.verifier as string, initiatedBy: r.initiated_by as string, messageSnapshot: r.message_snapshot as string,
    templateVersion: r.template_version as string, connectedAccount: r.connected_account as string, verifiedAt: r.verified_at as number,
  };
}

export function insertAttestation(db: Db, a: AttestationRow): void {
  db.prepare(
    `INSERT INTO wallet_ownership_attestation
       (id, entity_id, wallet, nonce, verifier, initiated_by, message_snapshot, template_version, connected_account, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.entityId, a.wallet, a.nonce, a.verifier, a.initiatedBy, a.messageSnapshot, a.templateVersion, a.connectedAccount, a.verifiedAt);
}

export function listAttestations(db: Db, entityId: string): AttestationRow[] {
  return (db.prepare('SELECT * FROM wallet_ownership_attestation WHERE entity_id = ? ORDER BY verified_at').all(entityId) as Record<string, unknown>[]).map(mapAtt);
}

export function latestAttestation(db: Db, entityId: string, wallet: string): AttestationRow | null {
  const r = db.prepare(
    'SELECT * FROM wallet_ownership_attestation WHERE entity_id = ? AND wallet = ? ORDER BY verified_at DESC LIMIT 1',
  ).get(entityId, wallet) as Record<string, unknown> | undefined;
  return r ? mapAtt(r) : null;
}
