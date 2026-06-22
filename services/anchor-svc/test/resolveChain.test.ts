import { describe, it, expect } from 'vitest';
import { resolveChain } from '../src/core/resolveChain.js';
import { AnchorError, type SuiChainPort, type ChainState } from '../src/domain/types.js';
import { deriveEntityRef } from '../src/core/entityRef.js';

function fakePort(state: Partial<ChainState>, capEpoch = 0n, capOwner?: string): SuiChainPort {
  return {
    getChainState: async () => ({ entityRef: deriveEntityRef('e1'), latestLink: new Uint8Array(32), seq: 0n, capEpoch: 0n, ...state }),
    getCapEpoch: async () => capEpoch,
    execAnchor: async () => { throw new Error('not used'); },
    ...(capOwner !== undefined ? { getCapOwner: async () => capOwner } : {}),
  };
}
const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

describe('resolveChain (A4 gate)', () => {
  it('passes when on-chain entity_ref matches derived ref and cap epoch matches', async () => {
    const r = await resolveChain('e1', reg, fakePort({ seq: 3n, capEpoch: 5n }, 5n));
    expect(r.chainObjectId).toBe('0xchain');
    expect(r.seq).toBe(3n);
  });
  it('fails closed when on-chain entity_ref does not match (registry tampered/wrong)', async () => {
    const bad = fakePort({ entityRef: deriveEntityRef('OTHER') });
    await expect(resolveChain('e1', reg, bad)).rejects.toMatchObject({ code: 'ENTITY_REF_MISMATCH' });
  });
  it('fails closed when cap epoch is stale (cap rotated, registry not updated)', async () => {
    const stale = fakePort({ capEpoch: 2n }, 1n); // chain at epoch 2, cap still epoch 1
    await expect(resolveChain('e1', reg, stale)).rejects.toMatchObject({ code: 'STALE_CAP' });
  });
  it('fails closed for unregistered entity before any chain read', async () => {
    await expect(resolveChain('nope', reg, fakePort({}))).rejects.toMatchObject({ code: 'ENTITY_NOT_REGISTERED' });
  });

  // C-2 cap-owner preflight tests
  it('throws CAP_NOT_OWNED_BY_WALLET when cap owner does not match walletAddress', async () => {
    const port = fakePort({}, 0n, '0xother');
    await expect(resolveChain('e1', reg, port, '0xwallet'))
      .rejects.toMatchObject({ code: 'CAP_NOT_OWNED_BY_WALLET' });
  });

  it('proceeds when cap owner matches walletAddress', async () => {
    const port = fakePort({ seq: 1n, capEpoch: 0n }, 0n, '0xwallet');
    const r = await resolveChain('e1', reg, port, '0xwallet');
    expect(r.chainObjectId).toBe('0xchain');
    expect(r.seq).toBe(1n);
  });

  it('skips preflight when walletAddress is not provided', async () => {
    // port without getCapOwner — no walletAddress → should not throw
    const port = fakePort({ seq: 2n, capEpoch: 0n }, 0n);
    const r = await resolveChain('e1', reg, port);
    expect(r.seq).toBe(2n);
  });
});
