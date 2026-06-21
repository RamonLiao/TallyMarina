import { AnchorError, LinkMismatchError, type AnchorResult, type EntityRegistry, type SuiChainPort } from './domain/types.js';
import { resolveChain } from './core/resolveChain.js';
import { buildAnchorArgs, type AnchorPayloadInput } from './core/buildAnchorArgs.js';

export interface AnchorDeps {
  port: SuiChainPort;
  registry: EntityRegistry;
  packageId: string;
}

export async function anchorSnapshot(
  entityId: string,
  payload: AnchorPayloadInput,
  deps: AnchorDeps,
): Promise<AnchorResult> {
  const { port, registry, packageId } = deps;

  // Validate args up front (fail-closed, no on-chain round trip on bad input).
  const args = buildAnchorArgs(payload);

  // Resolve + A4 gate; latestLink becomes prev_link.
  const resolved = await resolveChain(entityId, registry, port);

  const exec = (prevLink: Uint8Array) => port.execAnchor({
    packageId,
    chainObjectId: resolved.chainObjectId,
    capObjectId: resolved.capObjectId,
    prevLink,
    args,
  });

  try {
    return await exec(resolved.latestLink);
  } catch (e) {
    if (!(e instanceof LinkMismatchError)) throw e;
    // Concurrent writer / stale read: re-read head and retry exactly once.
    const fresh = await resolveChain(entityId, registry, port);
    try {
      return await exec(fresh.latestLink);
    } catch (e2) {
      if (e2 instanceof LinkMismatchError) {
        throw new AnchorError('LINK_MISMATCH_AFTER_RETRY',
          `prev_link still mismatched after one retry for entityId=${entityId}`);
      }
      throw e2;
    }
  }
}
