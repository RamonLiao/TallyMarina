import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { buildAnchorPtb } from '../src/core/buildAnchorPtb.js';

const input = {
  packageId: '0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d',
  chainObjectId: '0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f',
  capObjectId: '0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9',
  prevLink: new Uint8Array(32),
  walletAddress: '0x' + '11'.repeat(32),
  args: { manifestHash: 'ab'.repeat(32), merkleRoot: 'cd'.repeat(32), periodId: '2026-Q2', supersedesSeq: 0 },
};

describe('buildAnchorPtb', () => {
  it('returns serialized tx IR with sender set and no gas payment pinned', () => {
    const out = buildAnchorPtb(input);
    expect(out.capId).toBe(input.capObjectId);
    const tx = Transaction.from(out.txKind);          // IR must round-trip
    const data = JSON.parse(tx.serialize());
    expect(data.sender).toBe(input.walletAddress);
    expect(data.gasConfig?.payment ?? data.gasData?.payment ?? null).toBeNull(); // gas NOT pinned
  });
  it('rejects a bad-length hash (delegates to buildAnchorArgs validation)', () => {
    expect(() => buildAnchorPtb({ ...input, args: { ...input.args, manifestHash: 'zz' } })).toThrowError(/BAD_HASH_LEN/);
  });
});
