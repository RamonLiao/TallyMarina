import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'MISSING_PXFX' | 'INSUFFICIENT_LOT' | 'REPLAY_REVERSAL';

const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({ 'WALLET:0xA': 'SUI-A', 'WALLET:0xB': 'SUI-B' }[leg] ?? null),
};

export function makeInternalTransferInput(variant: Variant): RuleInput {
  // §7.8.3: 同 owner wallet A→B 移 40 SUI，carrying 120（lot 40 units cost 120）
  const base: RuleInput = {
    runContext: { runId: 'run-itx-1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'itx1', eventType: 'INTERNAL_TRANSFER', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xB',
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '40',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'INTERNAL_TRANSFER',
      ownershipChange: false, considerationAsset: null,
      considerationQtyMinor: null, considerationDecimals: null,
      rawPayloadHash: 'rawitx', txDigest: 'digitx', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [{ lotId: 'LOT-ITX-1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '40', costMinor: '120' }],
    prices: [],
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE': return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'MISSING_PXFX': return base; // no price/fx — valuation-independent, still POSTABLE
    case 'INSUFFICIENT_LOT': return { ...base, lots: [{ lotId: 'LOT-ITX-1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '10', costMinor: '30' }] };
    case 'REPLAY_REVERSAL': return base;
  }
}
