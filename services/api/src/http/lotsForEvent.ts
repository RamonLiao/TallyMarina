import type { Db } from '../store/db.js';
import type { EventRow } from '../store/eventStore.js';
import type { PositionLot, NormalizedEvent } from '../deps/rulesEngine.js';
import { foldRemainingLots } from '../store/lotMovementStore.js';
import { foldValuationStates, rawDeltaComponents } from '../store/revaluationStore.js';
import { getActivePolicy } from '../store/policyStore.js';
import { basisOf } from '../revaluation/orchestrate.js';

// Derived-ledger read (spec §4): remaining lots for the event's (wallet, coinType) pool,
// folded from persisted movements. Chronological run-rules ordering (Task 3) guarantees
// originating events persist before consumers read.
//
// §4.5 (CPA B1, Task 10): attach each lot's folded valuation state (cumulative reval delta /
// impairment) before handing lots to the engine — swapRules' disposal leg consumes it to
// derecognize the REVALUED carrying, not raw FIFO cost. Same per-coin basis dispatch a
// revaluation run used (basisOf), so foldValuationStates' mixed-basis guard (CPA B2) reads
// consistently with what a run wrote. Lots with no lot_valuation rows (never revalued) are
// returned untouched — byte-identical to pre-Task-10 behavior (regression lock).
export function lotsForEvent(db: Db, event: EventRow): PositionLot[] {
  const raw = JSON.parse(event.rawJson) as NormalizedEvent;
  const lots = foldRemainingLots(db, event.entityId, raw.wallet, raw.coinType);
  if (lots.length === 0) return lots;
  const { doc } = getActivePolicy(db, event.entityId);
  const basis = basisOf(doc, raw.coinType);
  const valuations = foldValuationStates(db, event.entityId, lots.map((l) => l.lotId), basis);
  // External-review fix: valuationDeltaMinor (used for carrying) mixes the P&L-booked period
  // reval delta with the equity-booked ASU-transition delta. Only the P&L share may ever be
  // reclassified into UnrealizedGainCryptoPnL/DisposalGain on disposal — compute it separately
  // (see rawDeltaComponents for the exact-ratio derivation) and hand it over as
  // valuationPnlDeltaMinor, distinct from the carrying-facing valuationDeltaMinor.
  const rawComponents = basis === 'GAAP_FV'
    ? rawDeltaComponents(db, event.entityId, lots.map((l) => l.lotId))
    : {};
  return lots.map((l) => {
    const v = valuations[l.lotId];
    if (!v) return l;
    if (basis === 'GAAP_FV') {
      if (v.cumulativeDeltaMinor === '0') return l;
      const comp = rawComponents[l.lotId];
      const rawTotal = comp ? BigInt(comp.rawPnl) + BigInt(comp.rawOpening) : 0n;
      const pnlRemaining = comp && rawTotal !== 0n
        ? (BigInt(comp.rawPnl) * BigInt(v.cumulativeDeltaMinor)) / rawTotal
        : 0n;
      return { ...l, valuationDeltaMinor: v.cumulativeDeltaMinor, valuationPnlDeltaMinor: pnlRemaining.toString() };
    }
    return v.cumulativeImpairmentMinor === '0' ? l : { ...l, valuationImpairMinor: v.cumulativeImpairmentMinor };
  });
}
