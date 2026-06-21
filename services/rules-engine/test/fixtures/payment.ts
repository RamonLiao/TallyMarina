import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT' | 'BREAK_EVEN';

const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({ EXPENSE: 'SVC-EXP', DISPOSAL: 'ASSET-SUI', DISPOSAL_GAIN: 'GAIN', DISPOSAL_LOSS: 'LOSS' }[leg] ?? null),
};

// COA that omits gain/loss mappings entirely — valid for break-even disposals
const coaNoGain: CoaMapping = {
  resolve: ({ leg }) =>
    ({ EXPENSE: 'SVC-EXP', DISPOSAL: 'ASSET-SUI' }[leg] ?? null),
};

export function makePaymentInput(variant: Variant): RuleInput {
  // §7.8.2: 支付 20 SUI 取得服務 FV 80；FIFO lot 20 units carrying 50
  const base: RuleInput = {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'pay1', eventType: 'DIGITAL_ASSET_PAYMENT', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xVENDOR',
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '20',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'SERVICE_PAYMENT',
      ownershipChange: true, considerationAsset: null,
      considerationQtyMinor: null, considerationDecimals: null,
      rawPayloadHash: 'rawpay', txDigest: 'digpay', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '20', costMinor: '50' }],
    prices: [{ id: 'PX-1', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '4' }],  // 20*4=80 FV
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE': return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE': return { ...base, prices: [] };
    case 'NO_FX': return { ...base, prices: [{ id: 'PX-EUR', coinType: '0x2::sui::SUI', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '4' }] };
    case 'INSUFFICIENT_LOT': return { ...base, lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '5', costMinor: '12' }] };
    // carrying == FV == 80 (20 units × price 4 = 80; lot costMinor = 80)
    case 'BREAK_EVEN': return { ...base, lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '20', costMinor: '80' }], coaMapping: coaNoGain };
  }
}
