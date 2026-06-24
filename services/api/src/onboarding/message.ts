// services/api/src/onboarding/message.ts
import { OWNERSHIP_TEMPLATE_VERSION } from './constants.js';

export interface OwnershipMessageInput {
  entityId: string; wallet: string; nonce: string; expiresAt: number;
}

export function buildOwnershipMessage(i: OwnershipMessageInput): string {
  return [
    'Subledger ownership proof',
    `version: ${OWNERSHIP_TEMPLATE_VERSION}`,
    `entity: ${i.entityId}`,
    `wallet: ${i.wallet}`,
    `nonce: ${i.nonce}`,
    `expires: ${new Date(i.expiresAt).toISOString()}`,
  ].join('\n');
}

export function encodeOwnershipMessage(i: OwnershipMessageInput): Uint8Array {
  return new TextEncoder().encode(buildOwnershipMessage(i));
}
