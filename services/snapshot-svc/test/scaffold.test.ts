import { describe, it, expect } from 'vitest';
import { buildMerkle } from '../src/deps/rulesEngine.js';
import { SnapshotError } from '../src/domain/types.js';

describe('snapshot-svc scaffold', () => {
  it('can reach rules-engine buildMerkle through deps chokepoint', () => {
    expect(typeof buildMerkle).toBe('function');
  });
  it('SnapshotError carries code', () => {
    const e = new SnapshotError('EMPTY_SNAPSHOT');
    expect(e.code).toBe('EMPTY_SNAPSHOT');
    expect(e).toBeInstanceOf(Error);
  });
});
