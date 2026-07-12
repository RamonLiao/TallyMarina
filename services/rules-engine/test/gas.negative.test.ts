import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import type { RuleInput, CoaMapping } from '../src/domain/types.js';
import { makeGasInput } from './fixtures/gas.js';

// §4.4.1: gas 淨額為負（rebate > 成本）——非費用支出而是淨流入，建新 lot，貸方以
// contra-expense（沖減當期 GasFeeExpense，以其累計餘額為限）+ 其他收入（GasRebateIncome）
// 兩段處理。negative net 用 economicPurpose = 'NETWORK_FEE_REBATE' 標記（quantityMinor 仍
// 為正整數，代表 |淨額|）。

const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({
      NETWORK_FEE: 'GasFeeExpense', DISPOSAL: 'ASSET-SUI', DISPOSAL_GAIN: 'GAIN', DISPOSAL_LOSS: 'LOSS',
      ACQUISITION: 'ASSET-SUI', REBATE_CONTRA: 'GasFeeExpense', REBATE_INCOME: 'GasRebateIncome',
    }[leg] ?? null),
};

function makeNegGasInput(args: { netQtyMinor: string; gasExpenseToDateMinor?: string; withPrice?: boolean }): RuleInput {
  return {
    runContext: {
      runId: 'run-neg-gas', entityId: 'ent', bookId: 'bk', periodId: '2026-06',
      mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z',
      gasExpenseToDateMinor: args.gasExpenseToDateMinor,
    },
    event: {
      schemaVersion: '1', eventId: 'gas-neg-1', eventType: 'GAS_FEE', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: args.netQtyMinor,
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'NETWORK_FEE_REBATE',
      ownershipChange: true, considerationAsset: null,
      considerationQtyMinor: null, considerationDecimals: null,
      rawPayloadHash: 'rawneg', txDigest: 'digneg', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [],
    prices: args.withPrice === false ? [] : [{ id: 'PX-NEG', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '1' }],
    fxRates: [],
    coaMapping: coa,
  };
}

describe('§4.4.1 gas negative net (event-time)', () => {
  it('under limit: net FV 30, gasExpenseToDate 100 → contra 30, no income line', () => {
    const out = evaluate(makeNegGasInput({ netQtyMinor: '30', gasExpenseToDateMinor: '100' }));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.leg === 'ACQUISITION')).toMatchObject({ side: 'DEBIT', amountMinor: '30' });
    expect(je.lines.find((l) => l.leg === 'REBATE_CONTRA')).toMatchObject({ side: 'CREDIT', amountMinor: '30' });
    expect(je.lines.find((l) => l.leg === 'REBATE_INCOME')).toBeUndefined();
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '30', deltaCostMinor: '30' });
  });

  it('exact limit: net FV 100, gasExpenseToDate 100 → contra 100, no income line', () => {
    const out = evaluate(makeNegGasInput({ netQtyMinor: '100', gasExpenseToDateMinor: '100' }));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.leg === 'REBATE_CONTRA')).toMatchObject({ side: 'CREDIT', amountMinor: '100' });
    expect(je.lines.find((l) => l.leg === 'REBATE_INCOME')).toBeUndefined();
  });

  it('over limit: net FV 130, gasExpenseToDate 100 → contra 100 + income 30', () => {
    const out = evaluate(makeNegGasInput({ netQtyMinor: '130', gasExpenseToDateMinor: '100' }));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.leg === 'ACQUISITION')).toMatchObject({ side: 'DEBIT', amountMinor: '130' });
    expect(je.lines.find((l) => l.leg === 'REBATE_CONTRA')).toMatchObject({ side: 'CREDIT', amountMinor: '100' });
    expect(je.lines.find((l) => l.leg === 'REBATE_INCOME')).toMatchObject({ side: 'CREDIT', amountMinor: '30' });
    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('missing gasExpenseToDateMinor defaults to "0" → all income, no contra', () => {
    const out = evaluate(makeNegGasInput({ netQtyMinor: '30' }));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.leg === 'REBATE_CONTRA')).toBeUndefined();
    expect(je.lines.find((l) => l.leg === 'REBATE_INCOME')).toMatchObject({ side: 'CREDIT', amountMinor: '30' });
  });

  it('missing price → PRICE_MISSING, decision not POSTABLE, no JE, no lot movement', () => {
    const out = evaluate(makeNegGasInput({ netQtyMinor: '30', gasExpenseToDateMinor: '100', withPrice: false }));
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.exceptions[0]!.code).toBe('PRICE_MISSING');
    expect(out.journalEntries).toEqual([]);
    expect(out.lotMovements).toEqual([]);
  });

  it('regression: positive gas (existing NETWORK_FEE happy path) unaffected', () => {
    const out = evaluate(makeGasInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'NET-FEE')).toMatchObject({ side: 'DEBIT', amountMinor: '8' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '5' });
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '-2', deltaCostMinor: '-5' });
  });
});
