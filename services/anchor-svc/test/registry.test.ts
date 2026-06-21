import { describe, it, expect } from 'vitest';
import { lookupEntity } from '../src/core/registry.js';
import { AnchorError } from '../src/domain/types.js';

const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

describe('lookupEntity', () => {
  it('returns the entry for a registered entity', () => {
    expect(lookupEntity(reg, 'e1')).toEqual({ chainObjectId: '0xchain', capObjectId: '0xcap' });
  });
  it('fails closed for an unregistered entity', () => {
    expect(() => lookupEntity(reg, 'nope')).toThrowError(AnchorError);
    try { lookupEntity(reg, 'nope'); } catch (e) { expect((e as AnchorError).code).toBe('ENTITY_NOT_REGISTERED'); }
  });
  it('does not treat inherited Object props as entries', () => {
    expect(() => lookupEntity(reg, 'toString')).toThrowError(AnchorError);
  });
});
