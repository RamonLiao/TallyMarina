import { describe, it, expect } from 'vitest';
import { AnchorError, LinkMismatchError, HASH_LEN, MAX_REF_LEN, U64_MAX } from '../src/domain/types.js';

describe('anchor-svc scaffold', () => {
  it('AnchorError carries a typed code', () => {
    const e = new AnchorError('STALE_CAP');
    expect(e.code).toBe('STALE_CAP');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AnchorError');
  });
  it('LinkMismatchError is a distinct error type', () => {
    expect(new LinkMismatchError('x')).toBeInstanceOf(Error);
    expect(new LinkMismatchError('x')).not.toBeInstanceOf(AnchorError);
  });
  it('exposes Move-aligned constants', () => {
    expect(HASH_LEN).toBe(32);
    expect(MAX_REF_LEN).toBe(64);
    expect(U64_MAX).toBe(2n ** 64n - 1n);
  });
});
