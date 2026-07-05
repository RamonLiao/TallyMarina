import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/index.js';
import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

// Mirror test/golden/gf-rcv.test.ts's receipt fixture (test/fixtures/receipt.ts) — copied literal,
// not invented — the zod gate in phaseSchema is strict.
const coa: CoaMapping = {
  resolve: ({ leg }) => {
    if (leg === 'ACQUISITION') return 'ASSET-SUI';
    if (leg === 'RECEIVABLE_SETTLEMENT') return 'AR';
    if (leg === 'OPENING_EQUITY') return 'OBE';
    return null;
  },
};

function buildBase(): RuleInput {
  return {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'ev1', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xCUST',
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null,
      considerationQtyMinor: null, considerationDecimals: null,
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
}

function openingInput(overrides: Record<string, unknown> = {}) {
  const base = buildBase();
  return {
    ...base,
    event: {
      ...base.event,
      eventType: 'OPENING_LOT',
      economicPurpose: 'OPENING_BALANCE',
      quantityMinor: '5000000000',
      openingCostMinor: '2500000',
      ...overrides,
    },
    lots: [], // opening events must not require pre-existing lots
  } as unknown as RuleInput;
}

describe('OPENING_LOT strategy', () => {
  it('originates a lot AND emits the opening-equity JE (opening-equity-je spec §3.1)', () => {
    const out = evaluate(openingInput());
    expect(out.decision).toBe('POSTABLE');
    expect(out.lotMovements).toHaveLength(1);
    expect(out.lotMovements[0]!.deltaCostMinor).toBe('2500000'); // historical cost, NOT repriced
    // The JE is what puts the opening basis into the merkle spine (evidence gap closed).
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0]!;
    expect(je.idempotencyKey).toBeTruthy(); // engine-standard key, assigned by index.ts
    const dr = je.lines.find((l) => l.side === 'DEBIT')!;
    const cr = je.lines.find((l) => l.side === 'CREDIT')!;
    expect(dr).toMatchObject({ account: 'ASSET-SUI', leg: 'ACQUISITION', amountMinor: '2500000',
      origCoinType: '0x2::sui::SUI', origQtyMinor: '5000000000' }); // qty+coin enter the leaf (spec §3.1/§6)
    expect(cr).toMatchObject({ account: 'OBE', leg: 'OPENING_EQUITY', amountMinor: '2500000',
      origCoinType: null, origQtyMinor: null });
  });

  it('MAPPING_MISSING fail-closed when the OPENING_EQUITY leg is unmapped (spec §3.2)', () => {
    const noEquity: CoaMapping = { resolve: ({ leg }) => (leg === 'ACQUISITION' ? 'ASSET-SUI' : null) };
    const out = evaluate({ ...openingInput(), coaMapping: noEquity } as RuleInput);
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.exceptions.some((e) => e.code === 'MAPPING_MISSING')).toBe(true);
  });
  it('fail-closed: missing openingCostMinor → rejected, no movement (spec §3)', () => {
    const out = evaluate(openingInput({ openingCostMinor: undefined }));
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.lotMovements).toHaveLength(0);
  });
  it('fail-closed: zero/negative/garbage quantity rejected (direction lives in event type, never sign — 2026-06-21 lesson)', () => {
    for (const q of ['0', '-5', 'abc', '']) {
      const out = evaluate(openingInput({ quantityMinor: q }));
      expect(out.decision).not.toBe('POSTABLE');
    }
  });
  it('fail-closed: non-numeric openingCostMinor rejected', () => {
    const out = evaluate(openingInput({ openingCostMinor: '-1' }));
    expect(out.decision).not.toBe('POSTABLE');
  });
  it('allows zero-cost opening lots (e.g. airdrop/fork with zero historical basis, spec §3)', () => {
    const out = evaluate(openingInput({ openingCostMinor: '0' }));
    expect(out.decision).toBe('POSTABLE');
    expect(out.lotMovements).toHaveLength(1);
    expect(out.lotMovements[0]!.deltaCostMinor).toBe('0');
    expect(out.journalEntries).toHaveLength(0); // D2: zero basis stays JE-less, unanchored by design
  });
});
