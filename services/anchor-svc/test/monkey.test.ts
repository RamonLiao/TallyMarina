import { describe, it, expect } from 'vitest';
import { deriveEntityRef, buildAnchorArgs, resolveChain, AnchorError, type SuiChainPort } from '../src/index.js';

const h32 = 'cd'.repeat(32);
const base = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };

describe('anchor-svc monkey', () => {
  it('huge unicode entityId still derives a 32-byte ref', () => {
    expect(deriveEntityRef('🚀'.repeat(50000)).length).toBe(32);
  });
  it('period exactly at 64 utf8 bytes passes, one byte over fails', () => {
    expect(buildAnchorArgs({ ...base, periodId: 'x'.repeat(64) }).periodId.length).toBe(64);
    expect(() => buildAnchorArgs({ ...base, periodId: 'x'.repeat(65) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('supersedesSeq = U64_MAX value (as Number boundary) — non-integer huge rejected', () => {
    // Number.MAX_SAFE_INTEGER is integer & < u64 max → accepted.
    expect(buildAnchorArgs({ ...base, supersedesSeq: Number.MAX_SAFE_INTEGER }).supersedesSeq)
      .toBe(BigInt(Number.MAX_SAFE_INTEGER));
    // Infinity / NaN rejected.
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: Number.POSITIVE_INFINITY })).toThrowError(/SEQ_OUT_OF_RANGE/);
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: Number.NaN })).toThrowError(/SEQ_OUT_OF_RANGE/);
  });
  it('tampered on-chain entity_ref is rejected even if registry id is right', async () => {
    const reg = { 'e1': { chainObjectId: '0xc', capObjectId: '0xk' } };
    const port: SuiChainPort = {
      getChainState: async () => ({ entityRef: deriveEntityRef('ATTACKER'), latestLink: new Uint8Array(32), seq: 0n, capEpoch: 0n }),
      getCapEpoch: async () => 0n,
      execAnchor: async () => { throw new Error('should not reach'); },
    };
    await expect(resolveChain('e1', reg, port)).rejects.toMatchObject({ code: 'ENTITY_REF_MISMATCH' });
  });
});
