import type { EventRow } from '../store/eventStore.js';
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate,
} from '../deps/rulesEngine.js';
import { DEMO_POLICY_SET, buildCoaMapping } from './policyConstants.js';

export function buildRuleInput(event: EventRow, opts: { periodId: string; periodOpen: boolean }): RuleInput {
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
  const lots: PositionLot[] = [{
    lotId: 'lot-1', seq: 1, coinType: ne.coinType, wallet: ne.wallet,
    remainingQtyMinor: '1000000000000', costMinor: '1000000',
  }];
  return { runContext, event: ne, policySet, assetAssessment, lots, prices, fxRates, coaMapping };
}
