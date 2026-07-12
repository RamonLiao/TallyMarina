// Shared minor-unit formatter (extracted from ReconTable for Task 12 — recon rows and the
// revaluation trial table must render amounts identically, one implementation).
export function fmtMinor(minor: string, decimals: number): string {
  // The scale is NOT allowed to default. null/undefined/float coerces via `null + 1 === 1` into a
  // wrong scale for free — 5000000000 prints "5,000,000,000" instead of "5,000.000000", off by 1e6,
  // with no `??` anywhere. The wire type is decimals:number|null; a source-scan guard cannot see the
  // coercion, only this runtime check can. Callers holding a null scale must render raw minor units.
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`fmtMinor: scale must be a non-negative integer, got ${String(decimals)}`);
  }
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + digits.slice(digits.length - decimals) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac}`;
}
