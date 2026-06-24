// services/api/src/onboarding/verify.ts
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { Db } from '../store/db.js';
import {
  getOpenChallenge, consumeChallenge, insertAttestation, type AttestationRow,
} from '../store/onboardingStore.js';
import { encodeOwnershipMessage, buildOwnershipMessage } from './message.js';
import { OWNERSHIP_VERIFIER, OWNERSHIP_INITIATED_BY, OWNERSHIP_TEMPLATE_VERSION } from './constants.js';
import { ApiError } from '../http/errors.js';

export interface VerifyInput {
  entityId: string; wallet: string; nonce: string; signature: string; connectedAccount: string;
}

export async function verifyOwnership(db: Db, input: VerifyInput, now: number): Promise<AttestationRow> {
  const wallet = normalizeSuiAddress(input.wallet);

  // Step 1: load open challenge — 422 if missing/expired/consumed
  const ch = getOpenChallenge(db, input.entityId, wallet, input.nonce, now);
  if (!ch) throw new ApiError(422, 'CHALLENGE_INVALID', 'CHALLENGE_INVALID: challenge missing, expired, or already used');

  // Step 2: rebuild bytes from STORED challenge (never trust client bytes)
  const bytes = encodeOwnershipMessage({ entityId: ch.entityId, wallet, nonce: ch.nonce, expiresAt: ch.expiresAt });

  // Step 3: crypto verify — no DB mutation; throw BAD_SIGNATURE on failure
  let pubKey;
  try {
    pubKey = await verifyPersonalMessageSignature(bytes, input.signature);
  } catch {
    // Do not leak the library's raw parse error into the client-facing body.
    throw new ApiError(422, 'BAD_SIGNATURE', 'BAD_SIGNATURE: signature verification failed');
  }

  // Step 4: bind recovered address to claimed wallet — throw ADDRESS_MISMATCH; nonce NOT consumed
  if (normalizeSuiAddress(pubKey.toSuiAddress()) !== wallet) {
    throw new ApiError(422, 'ADDRESS_MISMATCH', 'ADDRESS_MISMATCH: signature valid but not produced by this wallet');
  }

  // Step 5: atomic — consume challenge + insert attestation in a single transaction
  const messageSnapshot = buildOwnershipMessage({ entityId: ch.entityId, wallet, nonce: ch.nonce, expiresAt: ch.expiresAt });
  const att: AttestationRow = {
    id: `att-${input.entityId}-${wallet}-${ch.nonce}`,
    entityId: input.entityId, wallet, nonce: ch.nonce,
    verifier: OWNERSHIP_VERIFIER, initiatedBy: OWNERSHIP_INITIATED_BY,
    messageSnapshot, templateVersion: OWNERSHIP_TEMPLATE_VERSION,
    connectedAccount: input.connectedAccount, verifiedAt: now,
  };

  const run = db.transaction(() => {
    if (!consumeChallenge(db, input.entityId, wallet, input.nonce, now)) {
      throw new ApiError(422, 'CHALLENGE_INVALID', 'CHALLENGE_INVALID: challenge already used');
    }
    insertAttestation(db, att);
    return att;
  });

  return run();
}
