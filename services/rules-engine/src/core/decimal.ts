function toBig(s: string): bigint {
  if (!/^-?\d+$/.test(s)) throw new Error(`not a minor-unit integer: ${s}`);
  return BigInt(s);
}

export function addMinor(a: string, b: string): string { return (toBig(a) + toBig(b)).toString(); }
export function negMinor(a: string): string { return (-toBig(a)).toString(); }
export function sumMinor(xs: string[]): string { return xs.reduce((acc, x) => acc + toBig(x), 0n).toString(); }
export function isZeroMinor(a: string): boolean { return toBig(a) === 0n; }

// FV in priceCurrency minor = qty(whole) × unitPrice.
// qtyMinor 是 asset minor，需除以 10^assetDecimals 得 whole；用整數運算，要求整除。
export function mulUnitPrice(qtyMinor: string, assetDecimals: number, unitPriceMinor: string): string {
  const q = toBig(qtyMinor);
  const denom = 10n ** BigInt(assetDecimals);
  const product = q * toBig(unitPriceMinor);
  if (product % denom !== 0n) throw new Error('non-integer FV; price/qty scale mismatch');
  return (product / denom).toString();
}

export function applyFx(amountMinor: string, rateMinor: string, scale: number): string {
  const denom = 10n ** BigInt(scale);
  const product = toBig(amountMinor) * toBig(rateMinor);
  if (product % denom !== 0n) throw new Error('non-integer FX result; scale mismatch');
  return (product / denom).toString();
}
