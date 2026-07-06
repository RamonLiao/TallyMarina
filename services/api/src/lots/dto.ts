// GUARDRAIL: read-only. Builds the GET /entities/:id/lots DTO from the persisted lot
// ledger + a recompute-on-read simulation. No writes.
import type { Db } from '../store/db.js';
import { listLotMovements, foldRemainingLots, acquireLotSeq, type LotMovementRow } from '../store/lotMovementStore.js';
import { loadReconFixture } from '../reconciliation/fixture.js';
import { simulateLots } from './simulate.js';

// Frontend-reviewed contract (spec §5). Amounts are BigInt strings throughout.
// Additive fields (never break existing shape): top-level `simulationGaps` (always present,
// empty when clean) and per-drift optional `recomputedIncomplete` flag.
export interface LotsDTO {
  simulationGaps: string[];
  groups: Array<{
    wallet: string; coinType: string; decimals: number;
    lots: Array<{
      lotId: string; lotSeq: string; origin: 'opening' | 'derived';
      remainingQtyMinor: string; costMinor: string; originEventId: string;
      acquireJeId: string | null; // join key into GET /entities/:id/journal — null = unanchored (legacy/zero-basis opening)
      drift: null | {
        recomputed: { qtyMinor: string; costMinor: string };
        persisted: { qtyMinor: string; costMinor: string };
        recomputedIncomplete?: true;
      };
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

type LotEntry = LotsDTO['groups'][number]['lots'][number];

export function buildLotsDTO(db: Db, entityId: string): LotsDTO {
  const { lots: sim, simulationGaps, gapPools } = simulateLots(db, entityId);
  const decimals = decimalsLookup(entityId);
  const hasGaps = simulationGaps.length > 0;

  // Union of (wallet, coinType) pools from BOTH the persisted ledger and the recompute —
  // a sim-only pool (persisted rows deleted / folded to nothing) must still surface.
  const all = listLotMovements(db, entityId);
  const keys: string[] = [];
  const seen = new Set<string>();
  const pushKey = (k: string): void => { if (!seen.has(k)) { seen.add(k); keys.push(k); } };
  for (const mv of all) pushKey(`${mv.wallet}|${mv.coinType}`);
  for (const s of sim.values()) pushKey(`${s.wallet}|${s.coinType}`);

  // recomputedIncomplete: the recompute for this lot is not trustworthy — either the lot is
  // missing from the sim result, or a gap in its pool made the replay partial. Only meaningful
  // when gaps exist; an empty-gaps missing-from-sim {0,0} IS the honest recompute.
  const incomplete = (lotId: string, key: string): boolean =>
    hasGaps && (!sim.has(lotId) || gapPools.has(key));

  const groups: LotsDTO['groups'] = [];
  for (const key of keys) {
    const sep = key.indexOf('|');
    const wallet = key.slice(0, sep);
    const coinType = key.slice(sep + 1);
    const folded = foldRemainingLots(db, entityId, wallet, coinType);
    const groupMoves = listLotMovements(db, entityId, { wallet, coinType });
    const foldedIds = new Set(folded.map((l) => l.lotId));

    const lots: LotEntry[] = folded.map((lot) => {
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
        acquireJeId: acquire.jeId,
        drift: equal ? null : {
          recomputed: { qtyMinor: recomputedQty, costMinor: recomputedCost },
          persisted: { qtyMinor: lot.remainingQtyMinor, costMinor: lot.costMinor },
          ...(incomplete(lot.lotId, key) ? { recomputedIncomplete: true as const } : {}),
        },
        movements: moves.map((m: LotMovementRow) => ({
          eventId: m.eventId, jeId: m.jeId, periodId: m.periodId,
          deltaQtyMinor: m.deltaQtyMinor, deltaCostMinor: m.deltaCostMinor,
        })),
      };
    });

    // Sim-only drift: the recompute keeps a lot the persisted fold dropped (folded to zero,
    // or its rows were deleted). Emit it with the persisted side at 0/0 — honest, not faked.
    for (const [lotId, s] of sim) {
      if (`${s.wallet}|${s.coinType}` !== key || foldedIds.has(lotId)) continue;
      // A lot both sides agree is gone (sim drained to 0/0, same as the dropped persisted
      // fold) has no drift to report — emitting it here would be a phantom {0,0}-vs-{0,0}
      // entry, a false-positive drift on an actually-drained pool.
      if (s.qtyMinor === '0' && s.costMinor === '0') continue;
      const moves = groupMoves.filter((m) => m.lotId === lotId);
      const acquire = moves.find((m) => !m.deltaQtyMinor.startsWith('-'));
      lots.push({
        lotId,
        // Persisted lot_seq if any acquire row survives; otherwise the lot exists only in the
        // recompute and has no persisted sequence — do not fabricate one.
        lotSeq: acquire ? acquireLotSeq(db, entityId, lotId) : '',
        origin: (lotId.startsWith('OPEN-') ? 'opening' : 'derived') as 'opening' | 'derived',
        remainingQtyMinor: '0',
        costMinor: '0',
        originEventId: acquire?.eventId ?? s.originEventId, // sim knows the originating event
        acquireJeId: acquire?.jeId ?? null,
        drift: {
          recomputed: { qtyMinor: s.qtyMinor, costMinor: s.costMinor },
          persisted: { qtyMinor: '0', costMinor: '0' },
          ...(incomplete(lotId, key) ? { recomputedIncomplete: true as const } : {}),
        },
        movements: moves.map((m: LotMovementRow) => ({
          eventId: m.eventId, jeId: m.jeId, periodId: m.periodId,
          deltaQtyMinor: m.deltaQtyMinor, deltaCostMinor: m.deltaCostMinor,
        })),
      });
    }

    if (lots.length === 0) continue; // fully-consumed pool with no sim divergence
    groups.push({ wallet, coinType, decimals: decimals.get(key) ?? 9, lots });
  }
  return { simulationGaps, groups };
}
