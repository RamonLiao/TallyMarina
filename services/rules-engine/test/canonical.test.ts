import { describe, it, expect } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/core/canonical.js';

describe('canonical serialization', () => {
  it('orders object keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it('preserves explicit null (does not drop key)', () => {
    // why: lineage hash 要求不適用欄位以顯式 null 參與序列化
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });
  it('sha256Hex is stable and 64 hex chars', () => {
    const h = sha256Hex('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(sha256Hex('abc'));
  });
});
