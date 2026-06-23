import { describe, it, expect } from 'vitest';
import { deriveMode } from './auditSelection';

describe('deriveMode', () => {
  it('compare when 2+ events are checked', () => {
    expect(deriveMode({ selectedId: 'a', compareIds: ['a', 'b'] })).toBe('compare');
  });
  it('lineage when exactly one selected and <2 compared', () => {
    expect(deriveMode({ selectedId: 'a', compareIds: [] })).toBe('lineage');
    expect(deriveMode({ selectedId: 'a', compareIds: ['a'] })).toBe('lineage');
  });
  it('pick when nothing usable selected', () => {
    expect(deriveMode({ selectedId: null, compareIds: [] })).toBe('pick');
    expect(deriveMode({ selectedId: null, compareIds: ['a'] })).toBe('lineage'); // single check still drills
  });
});
