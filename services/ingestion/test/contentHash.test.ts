import { describe, it, expect } from 'vitest';
import { contentHash } from '../src/core/contentHash.js';

describe('contentHash', () => {
  it('is stable under key reordering', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
  it('differs when effect content differs', () => {
    expect(contentHash({ x: 1 })).not.toBe(contentHash({ x: 2 }));
  });
  it('ignores volatile metadata fields', () => {
    expect(contentHash({ x: 1, _rpcLatencyMs: 5 })).toBe(contentHash({ x: 1, _rpcLatencyMs: 9 }));
  });
});
