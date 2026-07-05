import type { Db } from '../store/db.js';
import type { EventRow } from '../store/eventStore.js';
import type { PositionLot, NormalizedEvent } from '../deps/rulesEngine.js';
import { foldRemainingLots } from '../store/lotMovementStore.js';

// Derived-ledger read (spec §4): remaining lots for the event's (wallet, coinType) pool,
// folded from persisted movements. Chronological run-rules ordering (Task 3) guarantees
// originating events persist before consumers read.
export function lotsForEvent(db: Db, event: EventRow): PositionLot[] {
  const raw = JSON.parse(event.rawJson) as NormalizedEvent;
  return foldRemainingLots(db, event.entityId, raw.wallet, raw.coinType);
}
