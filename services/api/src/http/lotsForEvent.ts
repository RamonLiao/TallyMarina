import type { Db } from '../store/db.js';
import type { EventRow } from '../store/eventStore.js';
import type { PositionLot, NormalizedEvent } from '../deps/rulesEngine.js';
import { foldRemainingLots } from '../store/lotMovementStore.js';
import { foldValuationStates, pnlBuckets } from '../store/revaluationStore.js';
import { getActivePolicy, type PolicyDoc } from '../store/policyStore.js';
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
//
// `doc` (I2 final-review): the two hot callers — run-rules' posting loop and collectExceptions —
// iterate many events while the entity's active policy is FIXED for the whole pass, so they load
// it ONCE and pass it here rather than paying a getActivePolicy read per event. It is optional
// only so the handful of one-shot callers (scripts, isolated tests) need not thread it; when
// omitted, the same active policy is loaded — behavior is identical either way.
export function lotsForEvent(db: Db, event: EventRow, doc?: PolicyDoc): PositionLot[] {
  const raw = JSON.parse(event.rawJson) as NormalizedEvent;
  const lots = foldRemainingLots(db, event.entityId, raw.wallet, raw.coinType);
  if (lots.length === 0) return lots;
  const policyDoc = doc ?? getActivePolicy(db, event.entityId).doc;
  const basis = basisOf(policyDoc, raw.coinType);
  const valuations = foldValuationStates(db, event.entityId, lots.map((l) => l.lotId), basis);
  // External-review fix: valuationDeltaMinor (used for carrying) mixes the P&L-booked period
  // reval delta with the equity-booked ASU-transition delta. Only the P&L share may ever be
  // reclassified into UnrealizedGainCryptoPnL/DisposalGain on disposal — hand it over as
  // valuationPnlDeltaMinor, distinct from the carrying-facing valuationDeltaMinor. pnlBuckets
  // sums it exactly from the persisted rows (see its doc comment for why proration broke
  // after C1's rerun-after-disposal supersede semantics).
  const buckets = basis === 'GAAP_FV'
    ? pnlBuckets(db, event.entityId, lots.map((l) => l.lotId))
    : {};
  return lots.map((l) => {
    const v = valuations[l.lotId];
    if (!v) return l;
    if (basis === 'GAAP_FV') {
      const pnlRemaining = buckets[l.lotId] ?? '0';
      // Untouched-lot fast path needs BOTH buckets empty: a lot whose opening and P&L deltas
      // offset to a zero cumulative delta still carries a reclassifiable P&L share.
      if (v.cumulativeDeltaMinor === '0' && pnlRemaining === '0') return l;
      return { ...l, valuationDeltaMinor: v.cumulativeDeltaMinor, valuationPnlDeltaMinor: pnlRemaining };
    }
    return v.cumulativeImpairmentMinor === '0' ? l : { ...l, valuationImpairMinor: v.cumulativeImpairmentMinor };
  });
}
