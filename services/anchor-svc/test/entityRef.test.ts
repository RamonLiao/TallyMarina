import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deriveEntityRef } from '../src/core/entityRef.js';

describe('deriveEntityRef', () => {
  it('is sha2-256 of utf8(entityId), 32 bytes', () => {
    const id = 'acme-corp:entity-001';
    const expected = new Uint8Array(createHash('sha256').update(Buffer.from(id, 'utf8')).digest());
    const got = deriveEntityRef(id);
    expect(got).toEqual(expected);
    expect(got.length).toBe(32);
  });
  it('stays 32 bytes for very long / unicode ids', () => {
    expect(deriveEntityRef('長'.repeat(10000)).length).toBe(32);
    expect(deriveEntityRef('日本語-entity-🚀').length).toBe(32);
  });
  it('is deterministic and distinct per id', () => {
    expect(deriveEntityRef('a')).toEqual(deriveEntityRef('a'));
    expect(deriveEntityRef('a')).not.toEqual(deriveEntityRef('b'));
  });
});
