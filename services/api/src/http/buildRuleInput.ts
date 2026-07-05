import type { EventRow } from '../store/eventStore.js';
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate,
} from '../deps/rulesEngine.js';
import { DEMO_POLICY_SET, buildCoaMapping } from './policyConstants.js';

export function buildRuleInput(event: EventRow, opts: { periodId: string; periodOpen: boolean; lots: PositionLot[] }): RuleInput {
  const raw = JSON.parse(event.rawJson) as NormalizedEvent;
  // Human review decision (spec §6.9) overrides the raw event classification; the AI
  // suggestion is never read here — it stays suggestion-only. An invalid finalEventType
  // fail-closes downstream via the rules engine's schema gate (SCHEMA_INVALID).
  const ne: NormalizedEvent = {
    ...raw,
    eventType: (event.finalEventType ?? raw.eventType) as NormalizedEvent['eventType'],
    economicPurpose: event.finalPurpose ?? raw.economicPurpose,
  };
  const runContext: RunContext = {
    runId: `run-${event.id}`, entityId: event.entityId, bookId: ne.bookId,
    periodId: opts.periodId, mode: 'POST', asOf: ne.eventTime,
  };
  // periodOpen resolves from the period_lock store per call — never from the constant
  // (review C1: the hardcoded `periodOpen: true` made the engine's PERIOD_CLOSED gate dead code).
  const policySet: ResolvedPolicySet = { ...DEMO_POLICY_SET, periodOpen: opts.periodOpen };
  const coaMapping = buildCoaMapping();
  const assetAssessment: ClassificationAssessment = {
    coinType: ne.coinType, status: 'APPROVED',
    accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST',
  };
  const prices: PricePoint[] = [{
    id: 'px-1', coinType: ne.coinType, priceCurrency: 'USD',
    asOfDate: ne.eventTime.slice(0, 10), unitPriceMinor: '100',
  }];
  const fxRates: FxRate[] = [];
  // Real lots fold from the persisted lot_movement ledger (spec §4, Task 4). The caller
  // supplies them via lotsForEvent — an empty pool now legitimately fails-closed with
  // INSUFFICIENT_LOT rather than posting against a fabricated demo lot.
  return { runContext, event: ne, policySet, assetAssessment, lots: opts.lots, prices, fxRates, coaMapping };
}
