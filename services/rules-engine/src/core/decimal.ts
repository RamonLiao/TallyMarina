function toBig(s: string): bigint {
  if (!/^-?\d+$/.test(s)) throw new Error(`not a minor-unit integer: ${s}`);
  return BigInt(s);
}

const MAX_EXP = 36;   // bound 10^n，防超大指數 BigInt 運算 DoS
function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0 || exp > MAX_EXP) throw new Error(`exponent out of range: ${exp}`);
  return 10n ** BigInt(exp);
}

export function addMinor(a: string, b: string): string { return (toBig(a) + toBig(b)).toString(); }
export function negMinor(a: string): string { return (-toBig(a)).toString(); }
export function sumMinor(xs: string[]): string { return xs.reduce((acc, x) => acc + toBig(x), 0n).toString(); }
export function isZeroMinor(a: string): boolean { return toBig(a) === 0n; }

// FV in priceCurrency minor = qty(whole) × unitPrice.
// qtyMinor 是 asset minor，需除以 10^assetDecimals 得 whole；用整數運算，要求整除。
export function mulUnitPrice(qtyMinor: string, assetDecimals: number, unitPriceMinor: string): string {
  const q = toBig(qtyMinor);
  const denom = pow10(assetDecimals);
  const product = q * toBig(unitPriceMinor);
  if (product % denom !== 0n) throw new Error('non-integer FV; price/qty scale mismatch');
  return (product / denom).toString();
}

export function applyFx(amountMinor: string, rateMinor: string, scale: number): string {
  const denom = pow10(scale);
  const product = toBig(amountMinor) * toBig(rateMinor);
  if (product % denom !== 0n) throw new Error('non-integer FX result; scale mismatch');
  return (product / denom).toString();
}
