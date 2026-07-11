import { describe, it, expect } from 'vitest';
import { breakPrecision } from '../src/assets/precision.js';

describe('breakPrecision — golden values from the real acme-pilot-001 fixture', () => {
  it('SUI +1.202 reaches the integer place, so it is flat nowhere', () => {
    // WHY: a whole-unit break is never rounding dust. flatToDecimal must be null,
    // not 3 — the naive `decimals - trailingZeros` formula gives 3 and is wrong.
    expect(breakPrecision('1202000000', 9)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 3,
    });
  });

  it('USDC -0.5 is flat at the integer place and unflat from decimal 1', () => {
    expect(breakPrecision('-500000', 6)).toEqual({
      exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1,
    });
  });

  it('one minor unit of a 9dp coin is flat to decimal 8', () => {
    expect(breakPrecision('1', 9)).toEqual({
      exactlyZero: false, flatToDecimal: 8, firstSignificantDecimal: 9, lastSignificantDecimal: 9,
    });
  });

  it('clamps lastSignificantDecimal at 0 when trailing zeros exceed decimals', () => {
    // WHY: 10 SUI = "10000000000" has 10 trailing zeros but only 9 decimals.
    // Without the clamp this returns -1 and every consumer indexes backwards.
    expect(breakPrecision('10000000000', 9)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });

  it('an exactly zero break is flat everywhere', () => {
    expect(breakPrecision('0', 9)).toEqual({
      exactlyZero: true, flatToDecimal: 9, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });

  it('handles decimals=0', () => {
    expect(breakPrecision('5', 0)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });
});

describe('breakPrecision — adversarial input (V4)', () => {
  // WHY: this codebase has already shipped a leading-zero bypass once (opening-equity I1).
  it.each([
    ['leading zeros', '007'],
    ['negative zero', '-0'],
    ['scientific notation', '1e3'],
    ['empty string', ''],
    ['whitespace', ' 1 '],
    ['decimal point', '1.5'],
    ['plus sign', '+1'],
    ['non-numeric', 'abc'],
  ])('rejects %s', (_label, bad) => {
    expect(() => breakPrecision(bad, 9)).toThrow(/invalid breakMinor/);
  });

  it('rejects an over-long string (padStart DoS)', () => {
    expect(() => breakPrecision('1'.repeat(81), 9)).toThrow(/invalid breakMinor/);
  });

  it('rejects out-of-range decimals', () => {
    expect(() => breakPrecision('1', -1)).toThrow(/invalid decimals/);
    expect(() => breakPrecision('1', 37)).toThrow(/invalid decimals/);
    expect(() => breakPrecision('1', 1.5)).toThrow(/invalid decimals/);
  });
});
