import { describe, it, expect } from 'vitest';
import { revalueLots } from '../src/revaluation/revalue.js';
import type { RevalueInput } from '../src/revaluation/types.js';

const SUI = '0x2::sui::SUI';
const base = (over: Partial<RevalueInput> = {}): RevalueInput => ({
  basis: 'GAAP_FV', entityId: 'e1', periodId: '2026-Q2', keyBase: 'e1:2026-Q2:1',
  lots: [{ lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' }], // 1 SUI @ $1,000.00
  valuations: {},
  prices: [{ id: 'px-q2-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '140000' }], // $1,400/SUI
  decimalsByCoin: { [SUI]: 9 },
  policySetVersion: 'ps-v1', ...over,
});

describe('revalueLots GAAP_FV', () => {
  it('升值：Dr DigitalAssets / Cr UnrealizedGainCryptoPnL，delta=+400', () => {
    const out = revalueLots(base());
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', basis: 'GAAP_FV', qtyMinor: '1000000000',
      priorCarryingMinor: '100000', currentValueMinor: '140000', deltaMinor: '40000',
      pricePointId: 'px-q2-sui', reason: 'REVALUE',
    })]);
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.idempotencyKey).toBe(`reval:e1:2026-Q2:1:${SUI}`);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '40000', priceRef: 'px-q2-sui' }),
      expect.objectContaining({ account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: '40000' }),
    ]);
  });
  it('貶值：Dr UnrealizedLossCryptoPnL / Cr DigitalAssets（獨立損失科目）', () => {
    const out = revalueLots(base({ prices: [{ id: 'px', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '70000' }] }));
    expect(out.journalEntries[0].lines.map(l => [l.account, l.side, l.amountMinor])).toEqual([
      ['UnrealizedLossCryptoPnL', 'DEBIT', '30000'], ['DigitalAssets', 'CREDIT', '30000'],
    ]);
  });
  it('prior valuation 存在時 baseline = cost + cumulativeDelta（不重複認列）', () => {
    const out = revalueLots(base({ valuations: { L1: { lotId: 'L1', cumulativeDeltaMinor: '40000', cumulativeImpairmentMinor: '0', qtyAtLastValuationMinor: '1000000000', hasOpeningSeq0: false } } }));
    // carrying 已 140000，價仍 1400 → delta 0 → 無 JE、無 valuation 列
    expect(out.journalEntries).toEqual([]);
    expect(out.valuations).toEqual([]);
  });
  it('缺價 → PRICE_MISSING exception，該 coin 不出 JE，其他 coin 照出（per-coin fail-closed，run 端全有全無由 api 把關）', () => {
    const out = revalueLots(base({ prices: [] }));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions).toEqual([expect.objectContaining({ code: 'PRICE_MISSING', detail: expect.objectContaining({ coinType: SUI }) })]);
  });
  it('同 coin 多 lot 併一張 JE，per-lot valuation 各一列', () => {
    const out = revalueLots(base({ lots: [
      { lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' },
      { lotId: 'L2', seq: 2, coinType: SUI, wallet: 'w1', remainingQtyMinor: '2000000000', costMinor: '300000' },
    ] }));
    expect(out.valuations).toHaveLength(2);
    expect(out.journalEntries).toHaveLength(1);
    // L1: 140000-100000=+40000；L2: 280000-300000=−20000；淨 +20000 → gain 20000
    expect(out.journalEntries[0].lines[0]).toEqual(expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '20000' }));
  });
});
