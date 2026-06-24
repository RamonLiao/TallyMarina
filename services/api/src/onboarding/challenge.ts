import { randomBytes } from 'node:crypto';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { Db } from '../store/db.js';
import { getEntity } from '../store/entityStore.js';
import { insertChallenge } from '../store/onboardingStore.js';
import { buildOwnershipMessage } from './message.js';
import { CHALLENGE_TTL_MS } from './constants.js';
import { ApiError } from '../http/errors.js';

export function issueChallenge(db: Db, entityId: string, walletRaw: string, now: number) {
  if (!getEntity(db, entityId)) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${entityId}`);
  const wallet = normalizeSuiAddress(walletRaw);
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = now + CHALLENGE_TTL_MS;
  insertChallenge(db, { entityId, wallet, nonce, expiresAt, consumedAt: null, createdAt: now });
  const message = buildOwnershipMessage({ entityId, wallet, nonce, expiresAt });
  return { nonce, message, expiresAt, wallet };
}
