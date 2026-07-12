import type { Db } from '../store/db.js';
import type { EventRow } from '../store/eventStore.js';
import type { PricePoint, NormalizedEvent } from '../deps/rulesEngine.js';
import { latestPricesAt } from '../store/pricePointStore.js';

// D14 read-path switchover: event-time prices for buildRuleInput's opts.prices, queried
// from the price_points store and mapped into the engine's PricePoint shape. Kept OUTSIDE
// buildRuleInput so that function stays pure (no DB access).
//
// latestPricesAt's `asOf` match is EXACT equality (`as_of = ?`), not "most recent ≤ asOf" —
// a price entered for any other date does not apply to this event even if it is the closest
// available one. That is intentional fail-closed behavior per spec D14: an event on a day
// with no matching price_points row gets an empty prices array here, which the engine turns
// into PRICE_MISSING rather than silently reusing a stale/adjacent day's price.
export function pricesForEvent(db: Db, event: EventRow): PricePoint[] {
  const raw = JSON.parse(event.rawJson) as NormalizedEvent;
  const asOf = raw.eventTime.slice(0, 10);
  return latestPricesAt(db, event.entityId, asOf).map((row) => ({
    id: row.id,
    coinType: row.coinType,
    priceCurrency: row.quoteCurrency,
    asOfDate: row.asOf,
    unitPriceMinor: row.priceMinor,
  }));
}
