// DATA ZONE — NEVER import Mascot here.
import type { JournalLine } from '../api/types';

export interface CoinRecon { coinType: string; acquiredMinor: bigint; disposedMinor: bigint; netMinor: bigint }

export function quantityRecon(lines: JournalLine[]): CoinRecon[] {
  const byCoin = new Map<string, { acquired: bigint; disposed: bigint }>();
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    if (!/^-?\d+$/.test(l.origQtyMinor)) {
      throw new Error(`quantityRecon: invalid origQtyMinor ${JSON.stringify(l.origQtyMinor)} on ${l.origCoinType}`);
    }
    const q = BigInt(l.origQtyMinor);
    if (q < 0n) throw new Error(`quantityRecon: origQtyMinor must be non-negative, got ${l.origQtyMinor}`);
    const c = byCoin.get(l.origCoinType) ?? { acquired: 0n, disposed: 0n };
    if (l.side === 'DEBIT') c.acquired += q; else c.disposed += q;
    byCoin.set(l.origCoinType, c);
  }
  return [...byCoin.entries()]
    .map(([coinType, v]) => ({ coinType, acquiredMinor: v.acquired, disposedMinor: v.disposed, netMinor: v.acquired - v.disposed }))
    .sort((a, b) => a.coinType.localeCompare(b.coinType));
}
