import { AnchorError, type EntityRegistry, type RegistryPort } from '../domain/types.js';
import { deriveEntityRef } from './entityRef.js';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Resolve each known entityId to its on-chain { chainObjectId, capObjectId } by
 * discovering the owner's AnchorCaps and matching sha256(entityId) against each
 * chain's entity_ref.
 *
 * Fail-closed:
 *  - entityId with no owned cap → ENTITY_CHAIN_NOT_FOUND (chain not bootstrapped,
 *    or cap rotated away from owner — these are indistinguishable without
 *    shared-object enumeration, which is out of scope).
 *  - same entity_ref on >=2 discovered chains → AMBIGUOUS_ENTITY_CHAIN.
 *  - any port/network error propagates unchanged.
 */
export async function buildRegistry(
  entityIds: string[],
  owner: string,
  originalPackageId: string,
  port: RegistryPort,
): Promise<EntityRegistry> {
  // Early return: empty entityIds → no port calls needed
  if (entityIds.length === 0) {
    return Object.create(null);
  }

  const caps = await port.listOwnedAnchorCaps(owner, originalPackageId);

  const byRef = new Map<string, { chainObjectId: string; capObjectId: string }>();
  for (const cap of caps) {
    const state = await port.getChainState(cap.chainId);
    const refHex = hex(state.entityRef);
    if (byRef.has(refHex)) {
      throw new AnchorError('AMBIGUOUS_ENTITY_CHAIN',
        `entity_ref ${refHex} maps to multiple chains (e.g. ${byRef.get(refHex)!.chainObjectId} and ${cap.chainId})`);
    }
    byRef.set(refHex, { chainObjectId: cap.chainId, capObjectId: cap.capObjectId });
  }

  const registry: EntityRegistry = Object.create(null);
  for (const entityId of entityIds) {
    const refHex = hex(deriveEntityRef(entityId));
    const hit = byRef.get(refHex);
    if (!hit) {
      throw new AnchorError('ENTITY_CHAIN_NOT_FOUND',
        `no owned AnchorCap for entityId=${entityId} (chain not bootstrapped, or cap rotated away from owner ${owner})`);
    }
    registry[entityId] = hit;
  }
  return registry;
}
