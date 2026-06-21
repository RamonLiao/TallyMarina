import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT';

const coa: CoaMapping = {
  resolve: ({ leg }) => {
    if (leg === 'ACQUISITION') return 'ASSET-SUI';
    if (leg === 'RECEIVABLE_SETTLEMENT') return 'AR';
    return null;
  },
};

export function makeReceiptInput(variant: Variant): RuleInput {
  // GF-RCV: 客戶以 100 SUI(decimals 0) 清償 AR；approved transaction-date FV 300 (functional USD)。
  const base: RuleInput = {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'ev1', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xCUST',
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null,
      rawPayloadHash: 'rawhash', txDigest: 'dig1', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [],
    prices: [{ id: 'PX-1', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '3' }],
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE':
      return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE':
      return { ...base, prices: [] };
    case 'NO_FX':
      // 報價幣別 EUR != functional USD，且未提供 fx → FX_MISSING
      return { ...base, prices: [{ id: 'PX-EUR', coinType: '0x2::sui::SUI', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '3' }], fxRates: [] };
    case 'INSUFFICIENT_LOT':
      // 提供一個極小 lot，驗證 receipt 不消耗它、不報 shortage
      return { ...base, lots: [{ lotId: 'OLD', coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '1', costMinor: '2' }] };
  }
}
