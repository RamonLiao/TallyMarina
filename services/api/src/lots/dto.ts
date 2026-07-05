// GUARDRAIL: read-only. Builds the GET /entities/:id/lots DTO from the persisted lot
// ledger + a recompute-on-read simulation. No writes.
import type { Db } from '../store/db.js';
import { listLotMovements, foldRemainingLots, acquireLotSeq, type LotMovementRow } from '../store/lotMovementStore.js';
import { loadReconFixture } from '../reconciliation/fixture.js';
import { simulateLots } from './simulate.js';

// Frontend-reviewed contract (spec §5). Amounts are BigInt strings throughout.
export interface LotsDTO {
  groups: Array<{
    wallet: string; coinType: string; decimals: number;
    lots: Array<{
      lotId: string; lotSeq: string; origin: 'opening' | 'derived';
      remainingQtyMinor: string; costMinor: string; originEventId: string;
      drift: null | { recomputed: { qtyMinor: string; costMinor: string }; persisted: { qtyMinor: string; costMinor: string } };
      movements: Array<{ eventId: string; jeId: string | null; periodId: string; deltaQtyMinor: string; deltaCostMinor: string }>;
    }>;
  }>;
}

// decimals convention mirrors reconciliation/collect.ts:60 — fixture row's decimals, else 9.
// Missing/malformed fixture is tolerated as "not configured" (empty) exactly like collectBreaks.
function decimalsLookup(entityId: string): Map<string, number> {
  const m = new Map<string, number>();
  try {
    for (const f of loadReconFixture(entityId)) m.set(`${f.wallet}|${f.coinType}`, f.decimals);
  } catch (e) {
    if (e instanceof Error && e.message === `no recon fixture for entity ${entityId}`) return m; // not configured
    throw e; // malformed fixture — fail loud (Rule 12)
  }
  return m;
}

export function buildLotsDTO(db: Db, entityId: string): LotsDTO {
  const { lots: sim } = simulateLots(db, entityId);
  const decimals = decimalsLookup(entityId);

  // Distinct (wallet, coinType) pools from the persisted ledger, in a stable order.
  const all = listLotMovements(db, entityId);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const mv of all) {
    const k = `${mv.wallet}|${mv.coinType}`;
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }

  const groups: LotsDTO['groups'] = [];
  for (const key of keys) {
    const sep = key.indexOf('|');
    const wallet = key.slice(0, sep);
    const coinType = key.slice(sep + 1);
    const folded = foldRemainingLots(db, entityId, wallet, coinType);
    if (folded.length === 0) continue; // fully-consumed pool contributes no open lots

    const groupMoves = listLotMovements(db, entityId, { wallet, coinType });
    const lots = folded.map((lot) => {
      const moves = groupMoves.filter((m) => m.lotId === lot.lotId);
      const acquire = moves.find((m) => !m.deltaQtyMinor.startsWith('-'));
      if (!acquire) throw new Error(`buildLotsDTO: lot ${lot.lotId} has no acquire movement — ledger corrupted`);
      const s = sim.get(lot.lotId);
      const recomputedQty = s?.qtyMinor ?? '0';
      const recomputedCost = s?.costMinor ?? '0';
      const equal = recomputedQty === lot.remainingQtyMinor && recomputedCost === lot.costMinor;
      return {
        lotId: lot.lotId,
        lotSeq: acquireLotSeq(db, entityId, lot.lotId),
        origin: (lot.lotId.startsWith('OPEN-') ? 'opening' : 'derived') as 'opening' | 'derived',
        remainingQtyMinor: lot.remainingQtyMinor,
        costMinor: lot.costMinor,
        originEventId: acquire.eventId,
        drift: equal ? null : {
          recomputed: { qtyMinor: recomputedQty, costMinor: recomputedCost },
          persisted: { qtyMinor: lot.remainingQtyMinor, costMinor: lot.costMinor },
        },
        movements: moves.map((m: LotMovementRow) => ({
          eventId: m.eventId, jeId: m.jeId, periodId: m.periodId,
          deltaQtyMinor: m.deltaQtyMinor, deltaCostMinor: m.deltaCostMinor,
        })),
      };
    });
    groups.push({ wallet, coinType, decimals: decimals.get(key) ?? 9, lots });
  }
  return { groups };
}
