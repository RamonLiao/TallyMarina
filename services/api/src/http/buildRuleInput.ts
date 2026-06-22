import type { EventRow } from '../store/eventStore.js';
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping,
} from '../deps/rulesEngine.js';

const coaMapping: CoaMapping = {
  resolve({ eventType, leg }): string | null {
    if (eventType === 'DIGITAL_ASSET_RECEIPT') return leg === 'L1' ? 'DigitalAssets' : 'AccountsReceivable';
    if (eventType === 'DIGITAL_ASSET_PAYMENT') return leg === 'L1' ? 'AccountsPayable' : 'DigitalAssets';
    return 'Suspense';
  },
};

export function buildRuleInput(event: EventRow, opts: { periodId: string }): RuleInput {
  const ne = JSON.parse(event.rawJson) as NormalizedEvent;
  const runContext: RunContext = {
    runId: `run-${event.id}`, entityId: event.entityId, bookId: ne.bookId,
    periodId: opts.periodId, mode: 'POST', asOf: ne.eventTime,
  };
  const policySet: ResolvedPolicySet = {
    policySetVersion: 'demo-ps-1', assetPolicyVersion: 'demo-ap-1', eventPolicyVersion: 'demo-ep-1',
    ruleVersion: 'demo-rule-1', parserVersion: 'demo-parse-1', normalizationVersion: 'demo-norm-1',
    costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
  };
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
