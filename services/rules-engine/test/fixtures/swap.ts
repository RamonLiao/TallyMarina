import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT' | 'REPLAY';

const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({
      ACQUISITION: 'ASSET-USDC',
      DISPOSAL: 'ASSET-SUI',
      DISPOSAL_GAIN: 'GAIN',
      DISPOSAL_LOSS: 'LOSS',
    }[leg] ?? null),
};

export function makeSwapInput(variant: Variant): RuleInput {
  // §7.8.4: 100 SUI (FIFO carrying 200) swapped for 300 USDC (FV 300)
  // → Dr USDC 300 / Cr SUI 200 / Cr disposal_gain 100
  const base: RuleInput = {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'swp1', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'SPOT_TRADE_SWAP',
      ownershipChange: true,
      considerationAsset: '0x2::usdc::USDC',
      considerationQtyMinor: '300',
      considerationDecimals: 0,
      rawPayloadHash: 'rawswp', txDigest: 'digswp', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '100', costMinor: '200' }],
    // price for USDC (consideration): 300 units * 1 USD/unit = 300 FV
    prices: [{ id: 'PX-USDC', coinType: '0x2::usdc::USDC', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '1' }],
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'REPLAY': return base;
    case 'SCOPE': return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE': return { ...base, prices: [] };
    case 'NO_FX': return {
      ...base,
      prices: [{ id: 'PX-EUR', coinType: '0x2::usdc::USDC', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '1' }],
    };
    case 'INSUFFICIENT_LOT': return {
      ...base,
      lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '50', costMinor: '100' }],
    };
  }
}
