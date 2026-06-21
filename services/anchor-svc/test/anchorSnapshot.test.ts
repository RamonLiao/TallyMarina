import { describe, it, expect } from 'vitest';
import { anchorSnapshot } from '../src/anchorSnapshot.js';
import { LinkMismatchError, type SuiChainPort, type ChainState, type AnchorResult, type ExecAnchorInput } from '../src/domain/types.js';
import { deriveEntityRef } from '../src/core/entityRef.js';

const h32 = 'ab'.repeat(32);
const payload = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };
const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

function makePort(opts: { link?: Uint8Array; execImpl?: (i: ExecAnchorInput) => Promise<AnchorResult> } = {}): { port: SuiChainPort; calls: ExecAnchorInput[]; setLink: (l: Uint8Array) => void } {
  let link = opts.link ?? new Uint8Array(32).fill(1);
  const calls: ExecAnchorInput[] = [];
  const state = (): ChainState => ({ entityRef: deriveEntityRef('e1'), latestLink: link, seq: 0n, capEpoch: 0n });
  const port: SuiChainPort = {
    getChainState: async () => state(),
    getCapEpoch: async () => 0n,
    execAnchor: async (i) => {
      calls.push(i);
      if (opts.execImpl) return opts.execImpl(i);
      return { digest: 'D', seq: 1n, link: new Uint8Array(32).fill(9) };
    },
  };
  return { port, calls, setLink: (l) => { link = l; } };
}

describe('anchorSnapshot', () => {
  it('resolves, passes current latest_link as prev_link, returns result', async () => {
    const { port, calls } = makePort({ link: new Uint8Array(32).fill(7) });
    const r = await anchorSnapshot('e1', payload, { port, registry: reg, packageId: '0xpkg' });
    expect(r.seq).toBe(1n);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prevLink).toEqual(new Uint8Array(32).fill(7));
    expect(calls[0]!.packageId).toBe('0xpkg');
  });

  it('on ELinkMismatch re-reads latest_link and retries once with the fresh link', async () => {
    const h = makePort();
    h.setLink(new Uint8Array(32).fill(1));
    let first = true;
    h.port.execAnchor = async (i) => {
      h.calls.push(i);
      if (first) { first = false; h.setLink(new Uint8Array(32).fill(2)); throw new LinkMismatchError(); }
      return { digest: 'D2', seq: 2n, link: new Uint8Array(32).fill(9) };
    };
    const r = await anchorSnapshot('e1', payload, { port: h.port, registry: reg, packageId: '0xpkg' });
    expect(r.digest).toBe('D2');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]!.prevLink).toEqual(new Uint8Array(32).fill(1)); // stale
    expect(h.calls[1]!.prevLink).toEqual(new Uint8Array(32).fill(2)); // refreshed
  });

  it('throws LINK_MISMATCH_AFTER_RETRY when mismatch persists', async () => {
    const h = makePort();
    h.port.execAnchor = async (i) => { h.calls.push(i); throw new LinkMismatchError(); };
    await expect(anchorSnapshot('e1', payload, { port: h.port, registry: reg, packageId: '0xpkg' }))
      .rejects.toMatchObject({ code: 'LINK_MISMATCH_AFTER_RETRY' });
    expect(h.calls).toHaveLength(2); // exactly one retry
  });

  it('does not retry on a validation error (fails closed before exec)', async () => {
    const h = makePort();
    await expect(anchorSnapshot('e1', { ...payload, periodId: 'p'.repeat(65) }, { port: h.port, registry: reg, packageId: '0xpkg' }))
      .rejects.toMatchObject({ code: 'PERIOD_TOO_LONG' });
    expect(h.calls).toHaveLength(0);
  });
});
