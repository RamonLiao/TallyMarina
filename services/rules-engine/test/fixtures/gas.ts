import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT';

const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({ NETWORK_FEE: 'NET-FEE', DISPOSAL: 'ASSET-SUI', DISPOSAL_GAIN: 'GAIN', DISPOSAL_LOSS: 'LOSS' }[leg] ?? null),
};

export function makeGasInput(variant: Variant): RuleInput {
  // §7.8.5: 2 SUI gas, FV 8 (2*4), FIFO lot 2 units carrying 5
  const base: RuleInput = {
    runContext: { runId: 'run-gas1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'gas1', eventType: 'GAS_FEE', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '2',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'NETWORK_FEE',
      ownershipChange: false, considerationAsset: null,
      considerationQtyMinor: null, considerationDecimals: null,
      rawPayloadHash: 'rawgas', txDigest: 'diggas', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [{ lotId: 'LOT-GAS1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '2', costMinor: '5' }],
    prices: [{ id: 'PX-GAS', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '4' }],  // 2*4=8 FV
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE': return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE': return { ...base, prices: [] };
    case 'NO_FX': return { ...base, prices: [{ id: 'PX-EUR', coinType: '0x2::sui::SUI', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '4' }] };
    case 'INSUFFICIENT_LOT': return { ...base, lots: [{ lotId: 'LOT-GAS1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '1', costMinor: '2' }] };
  }
}
