import { describe, it, expect } from 'vitest';
import { addMinor, negMinor, sumMinor, mulUnitPrice, applyFx, isZeroMinor } from '../src/core/decimal.js';

describe('decimal minor-unit helpers', () => {
  it('adds and negates without float', () => {
    expect(addMinor('300', '0')).toBe('300');
    expect(negMinor('300')).toBe('-300');
    expect(sumMinor(['300', '-300'])).toBe('0');
    expect(isZeroMinor('0')).toBe(true);
  });
  it('mulUnitPrice: 100 SUI (decimals 0) × unit 3 = 300', () => {
    // why: receipt FV 必須由 qty×price deterministically 得出，不可浮點
    expect(mulUnitPrice('100', 0, '3')).toBe('300');
  });
  it('mulUnitPrice respects asset decimals (1.00 unit, decimals 2, price 3 = 3)', () => {
    expect(mulUnitPrice('100', 2, '3')).toBe('3');
  });
  it('applyFx scales correctly (300 × 1.0 with scale 0 = 300)', () => {
    expect(applyFx('300', '1', 0)).toBe('300');
  });
  it('rejects non-integer minor string', () => {
    expect(() => addMinor('1.5', '0')).toThrow();
  });
});
