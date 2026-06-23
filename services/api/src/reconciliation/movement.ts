// BigInt-only netting of original-asset quantities per coinType.
// CANONICAL PRIMITIVE — must stay byte-identical to web/src/lib/balance.ts origMemo.
// Verified by services/api/test/recon.parity.test.ts (merge gate). Do NOT diverge.
export interface JeLine {
  side: 'DEBIT' | 'CREDIT';
  origCoinType: string | null;
  origQtyMinor: string | null;
}

export function netByCoinType(lines: JeLine[]): Record<string, bigint> {
  const memo: Record<string, bigint> = {};
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    const q = BigInt(l.origQtyMinor);
    memo[l.origCoinType] = (memo[l.origCoinType] ?? 0n) + (l.side === 'DEBIT' ? q : -q);
  }
  return memo;
}
