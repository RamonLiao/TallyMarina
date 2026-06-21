import { describe, it, expect } from 'vitest';
import { buildAnchorArgs } from '../src/core/buildAnchorArgs.js';

const h32 = 'ab'.repeat(32); // 64 hex chars = 32 bytes
const base = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };

describe('buildAnchorArgs (fail-closed)', () => {
  it('converts a valid payload', () => {
    const a = buildAnchorArgs(base);
    expect(a.manifestHash.length).toBe(32);
    expect(a.merkleRoot.length).toBe(32);
    expect(a.periodId).toEqual(new Uint8Array(Buffer.from('2026-Q2', 'utf8')));
    expect(a.supersedesSeq).toBe(0n);
  });
  it('accepts 0x-prefixed hashes', () => {
    expect(buildAnchorArgs({ ...base, manifestHash: '0x' + h32 }).manifestHash.length).toBe(32);
  });
  it('rejects a non-32-byte hash', () => {
    expect(() => buildAnchorArgs({ ...base, merkleRoot: 'abcd' })).toThrowError(/BAD_HASH_LEN/);
  });
  it('rejects odd-length / non-hex hash', () => {
    expect(() => buildAnchorArgs({ ...base, manifestHash: 'abc' })).toThrowError(/BAD_HASH_LEN/);
    expect(() => buildAnchorArgs({ ...base, manifestHash: 'zz'.repeat(32) })).toThrowError(/BAD_HASH_LEN/);
  });
  it('accepts periodId at exactly 64 bytes but rejects 65', () => {
    expect(buildAnchorArgs({ ...base, periodId: 'p'.repeat(64) }).periodId.length).toBe(64);
    expect(() => buildAnchorArgs({ ...base, periodId: 'p'.repeat(65) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('counts periodId length in UTF-8 bytes, not code points', () => {
    // '長' is 3 UTF-8 bytes; 22 of them = 66 bytes > 64.
    expect(() => buildAnchorArgs({ ...base, periodId: '長'.repeat(22) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('rejects negative / non-integer / oversize seq', () => {
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: -1 })).toThrowError(/SEQ_OUT_OF_RANGE/);
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: 1.5 })).toThrowError(/SEQ_OUT_OF_RANGE/);
  });
});
