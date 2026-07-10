/**
 * Where does a reconciliation break stop being zero?
 *
 * Truncation, never rounding: breakMinor is already an exact minor-unit integer, so a
 * rounding definition would need a half-up/half-even ruling AND would misreport 0.0005
 * as occupying a place it does not. All arithmetic is on digit strings — a break on an
 * 18dp asset overflows a double long before it overflows this.
 */
export type BreakPrecision = {
  /** The break is zero. */
  exactlyZero: boolean;
  /** Truncating to this many decimal places yields zero. null = the break reaches the
   *  integer place, so it is flat at no decimal place at all. exactlyZero => decimals. */
  flatToDecimal: number | null;
  /** First nonzero decimal place, 1-based. null iff flatToDecimal is null or exactlyZero. */
  firstSignificantDecimal: number | null;
  /** Least significant decimal place, 1-based. 0 when the break is a whole-unit multiple. */
  lastSignificantDecimal: number;
};

const MINOR = /^-?(0|[1-9][0-9]*)$/;
const MAX_LEN = 80;

function trailingZeros(s: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === '0'; i--) n++;
  return n;
}

export function breakPrecision(breakMinor: string, decimals: number): BreakPrecision {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  if (typeof breakMinor !== 'string' || breakMinor.length > MAX_LEN || !MINOR.test(breakMinor) || breakMinor === '-0') {
    throw new Error(`invalid breakMinor: ${breakMinor}`);
  }

  const s = breakMinor.startsWith('-') ? breakMinor.slice(1) : breakMinor;
  const D = decimals;

  if (s === '0') {
    return { exactlyZero: true, flatToDecimal: D, firstSignificantDecimal: null, lastSignificantDecimal: 0 };
  }

  // Clamp: "10000000000" has 10 trailing zeros against 9 decimals.
  const lastSignificantDecimal = Math.max(0, D - trailingZeros(s));
  const intPart = s.length > D ? s.slice(0, s.length - D) : '0';

  if (intPart !== '0') {
    return { exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal };
  }

  const frac = s.slice(Math.max(0, s.length - D)).padStart(D, '0');
  const i = frac.search(/[1-9]/);
  return { exactlyZero: false, flatToDecimal: i, firstSignificantDecimal: i + 1, lastSignificantDecimal };
}
