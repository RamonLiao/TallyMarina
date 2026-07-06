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
    const rawEvent = JSON.parse(ev.rawJson) as { wallet?: string; eventType?: string };
    const wallet = rawEvent.wallet;
    if (!wallet) throw new Error(`recon: event ${ev.id} has no wallet`);
    // OPENING_LOT declares pre-history holdings, not period activity: its chain-side
    // counterpart is the recon fixture's openingMinor, not a book movement. Folding its
    // ACQUISITION leg (which carries origQtyMinor/origCoinType for merkle anchoring, per
    // openingLotRules.ts) in here would double-count the same holding on both sides of
    // computed = opening + movement. Zero-basis OPENING_LOT (JE-less) is already excluded
    // from this fold by construction, so skipping non-zero OPENING_LOT JEs here restores
    // that symmetry. Discriminator: (finalEventType ?? rawEvent.eventType) — must mirror the
    // exact precedence buildRuleInput.ts uses to pick the type the engine actually posted
    // under (spec §6.9 human review override). Reading rawEvent.eventType alone would exclude
    // a reclassified-away-from-OPENING_LOT JE's real movement (masking genuine breaks) or
    // fold in a reclassified-into-OPENING_LOT JE's leg as double-counted movement.
    if ((ev.finalEventType ?? rawEvent.eventType) === 'OPENING_LOT') continue;
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
