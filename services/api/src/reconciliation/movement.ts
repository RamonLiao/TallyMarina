// BigInt-only netting of original-asset quantities per coinType.
// CANONICAL PRIMITIVE — must stay byte-identical to web/src/lib/balance.ts origMemo.
// Verified by services/api/test/recon.parity.test.ts (merge gate). Do NOT diverge.
import type { Db } from '../store/db.js';
import { listJournal } from '../store/journalStore.js';
import { getEvent } from '../store/eventStore.js';

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

export interface MovementResult {
  byKey: Record<string, bigint>; // `${wallet}|${coinType}` -> net qty
  control: Record<string, { debit: bigint; credit: bigint; legs: number }>;
}

export function walletAssetMovements(db: Db, entityId: string): MovementResult {
  const byKey: Record<string, bigint> = {};
  const control: Record<string, { debit: bigint; credit: bigint; legs: number }> = {};
  for (const r of listJournal(db, entityId)) {
    const ev = getEvent(db, r.eventId);
    if (!ev) throw new Error(`recon: JE ${r.id} references missing event ${r.eventId}`);
    const wallet = (JSON.parse(ev.rawJson) as { wallet?: string }).wallet;
    if (!wallet) throw new Error(`recon: event ${ev.id} has no wallet`);
    const je = JSON.parse(r.jeJson) as { lines: JeLine[] };
    const net = netByCoinType(je.lines);
    for (const [coinType, qty] of Object.entries(net)) {
      const key = `${wallet}|${coinType}`;
      byKey[key] = (byKey[key] ?? 0n) + qty;
    }
    for (const l of je.lines) {
      if (!l.origCoinType || !l.origQtyMinor) continue;
      const key = `${wallet}|${l.origCoinType}`;
      const c = control[key] ?? { debit: 0n, credit: 0n, legs: 0 };
      const q = BigInt(l.origQtyMinor);
      if (l.side === 'DEBIT') c.debit += q; else c.credit += q;
      c.legs += 1;
      control[key] = c;
    }
  }
  return { byKey, control };
}
