import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../src/core/buildRegistry.js';
import { deriveEntityRef } from '../src/core/entityRef.js';
import { AnchorError, type ChainState, type OwnedCap, type RegistryPort } from '../src/domain/types.js';

const OWNER = '0xowner';
const ORIG_PKG = '0xpkg';

function chainState(entityId: string): ChainState {
  return {
    entityRef: deriveEntityRef(entityId),
    latestLink: new Uint8Array(32),
    seq: 0n,
    capEpoch: 0n,
  };
}

/** Fake port: caps list + a chainId→entityId map for entity_ref synthesis. */
function fakePort(caps: OwnedCap[], chainEntity: Record<string, string>): RegistryPort {
  return {
    async listOwnedAnchorCaps() {
      return caps;
    },
    async getChainState(chainObjectId: string): Promise<ChainState> {
      const entityId = chainEntity[chainObjectId];
      if (entityId === undefined) throw new Error(`fake: no chain ${chainObjectId}`);
      return chainState(entityId);
    },
  };
}

describe('buildRegistry', () => {
  it('resolves all entityIds to their chain/cap ids', async () => {
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapA', chainId: '0xchainA' },
      { capObjectId: '0xcapB', chainId: '0xchainB' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA', '0xchainB': 'entB' });
    const reg = await buildRegistry(['entA', 'entB'], OWNER, ORIG_PKG, port);
    expect(reg).toEqual({
      entA: { chainObjectId: '0xchainA', capObjectId: '0xcapA' },
      entB: { chainObjectId: '0xchainB', capObjectId: '0xcapB' },
    });
  });

  it('matches by entity_ref hash, not by list position', async () => {
    // caps order is REVERSED vs entityIds; only hash matching can resolve correctly.
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapB', chainId: '0xchainB' },
      { capObjectId: '0xcapA', chainId: '0xchainA' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA', '0xchainB': 'entB' });
    const reg = await buildRegistry(['entA', 'entB'], OWNER, ORIG_PKG, port);
    expect(reg.entA).toEqual({ chainObjectId: '0xchainA', capObjectId: '0xcapA' });
    expect(reg.entB).toEqual({ chainObjectId: '0xchainB', capObjectId: '0xcapB' });
  });

  it('empty entityIds yields empty registry WITHOUT calling port', async () => {
    // port.listOwnedAnchorCaps THROWS if called → early return must skip the call
    const port: RegistryPort = {
      async listOwnedAnchorCaps() {
        throw new Error('port.listOwnedAnchorCaps should not be called for empty entityIds');
      },
      async getChainState() {
        throw new Error('port.getChainState should not be called for empty entityIds');
      },
    };
    const reg = await buildRegistry([], OWNER, ORIG_PKG, port);
    expect(reg).toEqual({});
    expect(Object.getPrototypeOf(reg)).toBeNull();
  });

  it('throws ENTITY_CHAIN_NOT_FOUND when no owned cap matches (rotated away or unbootstrapped)', async () => {
    const port = fakePort([{ capObjectId: '0xcapA', chainId: '0xchainA' }], { '0xchainA': 'entA' });
    await expect(buildRegistry(['entMissing'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'ENTITY_CHAIN_NOT_FOUND',
    });
    await expect(buildRegistry(['entMissing'], OWNER, ORIG_PKG, port)).rejects.toThrow(/rotated away|not bootstrapped/i);
  });

  it('throws AMBIGUOUS_ENTITY_CHAIN when two chains share an entity_ref', async () => {
    const caps: OwnedCap[] = [
      { capObjectId: '0xcap1', chainId: '0xchain1' },
      { capObjectId: '0xcap2', chainId: '0xchain2' },
    ];
    // both chains report the SAME entityId → same entity_ref
    const port = fakePort(caps, { '0xchain1': 'dup', '0xchain2': 'dup' });
    await expect(buildRegistry(['dup'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'AMBIGUOUS_ENTITY_CHAIN',
    });
  });

  it('propagates a port error mid-scan (never swallowed)', async () => {
    const port: RegistryPort = {
      async listOwnedAnchorCaps() {
        return [{ capObjectId: '0xcapA', chainId: '0xchainBOOM' }];
      },
      async getChainState() {
        throw new Error('network down');
      },
    };
    await expect(buildRegistry(['entA'], OWNER, ORIG_PKG, port)).rejects.toThrow('network down');
  });

  it('duplicate cap entries pointing at the SAME chain trigger AMBIGUOUS_ENTITY_CHAIN', async () => {
    // Two caps, same chainId → same entity_ref seen twice → ambiguous (fail-closed).
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapX', chainId: '0xchainA' },
      { capObjectId: '0xcapY', chainId: '0xchainA' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA' });
    await expect(buildRegistry(['entA'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'AMBIGUOUS_ENTITY_CHAIN',
    });
  });

  it('registry created with Object.create(null) is not vulnerable to prototype pollution', async () => {
    // If someone passes entityId="__proto__", it should NOT pollute Object.prototype
    // even though registry[entityId] = value would normally do so.
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapA', chainId: '0xchainA' },
    ];
    const port = fakePort(caps, { '0xchainA': 'benign' });
    const reg = await buildRegistry(['benign'], OWNER, ORIG_PKG, port);

    // Verify registry has null prototype (no Object.prototype chain)
    expect(Object.getPrototypeOf(reg)).toBeNull();

    // Verify a separate plain object is not polluted
    const testObj = {};
    expect(Object.getOwnPropertyNames(testObj)).toEqual([]);
    expect((testObj as any).injected).toBeUndefined();
  });
});
