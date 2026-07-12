// 代幣 minor × 單價（法幣 minor / whole coin）→ 法幣 minor，floor。
export function valueOfQty(qtyMinor: string, unitPriceMinor: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`valueOfQty: bad decimals ${decimals}`);
  return (BigInt(qtyMinor) * BigInt(unitPriceMinor) / 10n ** BigInt(decimals)).toString();
}
