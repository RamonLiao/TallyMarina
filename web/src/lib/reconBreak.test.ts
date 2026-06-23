import { describe, it, expect } from 'vitest';
import { computeBreak } from './reconBreak';

describe('computeBreak', () => {
  it('computed > statement → book-over, material above threshold', () => {
    const r = computeBreak('5000000000', '3798000000', '1000000000');
    expect(r.breakMinor).toBe(1202000000n);
    expect(r.direction).toBe('book-over');
    expect(r.material).toBe(true);
  });
  it('computed < statement → statement-over', () => {
    const r = computeBreak('0', '750000000', '100000');
    expect(r.direction).toBe('statement-over');
    expect(r.breakMinor).toBe(-750000000n);
  });
  it('zero break → balanced, never material', () => {
    const r = computeBreak('100', '100', '0');
    expect(r.direction).toBe('balanced');
    expect(r.material).toBe(false);
  });
});
