import { createHash } from 'node:crypto';

/**
 * Canonical entity reference: sha2-256 over UTF-8 bytes of entityId.
 * SINGLE SOURCE OF TRUTH — bootstrap (create_chain) and resolveChain's
 * cross-verification MUST both call this. Always 32 bytes.
 */
export function deriveEntityRef(entityId: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(Buffer.from(entityId, 'utf8')).digest());
}
