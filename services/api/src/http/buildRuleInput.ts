import type { EventRow } from '../store/eventStore.js';
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate,
} from '../deps/rulesEngine.js';
import { DEMO_POLICY_SET, buildCoaMapping } from './policyConstants.js';

export function buildRuleInput(event: EventRow, opts: { periodId: string }): RuleInput {
  const ne = JSON.parse(event.rawJson) as NormalizedEvent;
  const runContext: RunContext = {
    runId: `run-${event.id}`, entityId: event.entityId, bookId: ne.bookId,
    periodId: opts.periodId, mode: 'POST', asOf: ne.eventTime,
  };
  const policySet: ResolvedPolicySet = DEMO_POLICY_SET;
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
