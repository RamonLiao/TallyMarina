import { AnchorError, type EntityRegistry, type SuiChainPort } from '../domain/types.js';
import { lookupEntity } from './registry.js';
import { deriveEntityRef } from './entityRef.js';

export interface ResolvedChain {
  chainObjectId: string;
  capObjectId: string;
  latestLink: Uint8Array;
  seq: bigint;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function resolveChain(
  entityId: string,
  registry: EntityRegistry,
  port: SuiChainPort,
  walletAddress?: string,
): Promise<ResolvedChain> {
  const entry = lookupEntity(registry, entityId); // ENTITY_NOT_REGISTERED

  // Cap-owner preflight: if the port supports it and a walletAddress is given,
  // verify ownership before any on-chain read (fail-closed, avoids wasted gas).
  if (walletAddress != null && port.getCapOwner != null) {
    const capOwner = await port.getCapOwner(entry.capObjectId).catch(() => undefined);
    if (capOwner !== walletAddress) {
      throw new AnchorError('CAP_NOT_OWNED_BY_WALLET',
        `cap ${entry.capObjectId} owner=${capOwner ?? 'unknown'} !== wallet=${walletAddress}`);
    }
  }

  const state = await port.getChainState(entry.chainObjectId);

  // A4: cross-verify on-chain entity_ref against the derived ref.
  if (!bytesEqual(state.entityRef, deriveEntityRef(entityId))) {
    throw new AnchorError('ENTITY_REF_MISMATCH',
      `chain ${entry.chainObjectId} entity_ref does not match derived ref for entityId=${entityId}`);
  }

  // F2: early cap-epoch check (fail-closed, saves gas vs on-chain EStaleCap abort).
  const capEpoch = await port.getCapEpoch(entry.capObjectId);
  if (capEpoch !== state.capEpoch) {
    throw new AnchorError('STALE_CAP',
      `cap ${entry.capObjectId} epoch=${capEpoch} != chain cap_epoch=${state.capEpoch}`);
  }

  return { chainObjectId: entry.chainObjectId, capObjectId: entry.capObjectId, latestLink: state.latestLink, seq: state.seq };
}
