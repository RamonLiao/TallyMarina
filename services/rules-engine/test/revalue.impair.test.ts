import { describe, it, expect } from 'vitest';
import { revalueLots } from '../src/revaluation/revalue.js';
import type { RevalueInput } from '../src/revaluation/types.js';

const SUI = '0x2::sui::SUI';
const base = (over: Partial<RevalueInput> = {}): RevalueInput => ({
  basis: 'IFRS_COST', entityId: 'e1', periodId: '2026-Q2', keyBase: 'e1:2026-Q2:1',
  lots: [{ lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' }], // 1 SUI @ $1,000.00
  valuations: {},
  prices: [{ id: 'px-q2-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '70000' }], // $700/SUI
  decimalsByCoin: { [SUI]: 9 },
  policySetVersion: 'ps-v1', ...over,
});

describe('revalueLots impairment tracks (IFRS_COST / GAAP_COST)', () => {
  // 序列 A：cost 100000（$1,000），價跌至 $700 → IMPAIR 30000
  it('IFRS 減損：Dr ImpairmentLoss 30000 / Cr DigitalAssets 30000', () => {
    const out = revalueLots(base());
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', basis: 'IFRS_COST',
      priorCarryingMinor: '100000', currentValueMinor: '70000', deltaMinor: '-30000',
      pricePointId: 'px-q2-sui', reason: 'IMPAIR',
    })]);
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.idempotencyKey).toBe(`reval:e1:2026-Q2:1:${SUI}`);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'ImpairmentLoss', side: 'DEBIT', amountMinor: '30000', priceRef: 'px-q2-sui' }),
      expect.objectContaining({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '30000' }),
    ]);
  });

  // 序列 B（迴轉雙上限，CPA S4 序列）：qtyAtLastValuation=100 單位、cumImpair=30000、
  // 現 remainingQty=50 單位（處分過半）、cost(剩餘)=50000。價回升，value=60000。
  // cap2 = 30000 × 50/100 = 15000；carrying = 50000 − 15000 = 35000；
  // recovery = 60000 − 35000 = 25000；cap1 = 50000 − 35000 = 15000。
  // reversal = min(25000, 15000, 15000) = 15000。
  const seqBLots = () => ([{ lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '50', costMinor: '50000' }]);
  const seqBValuations = () => ({ L1: { lotId: 'L1', cumulativeDeltaMinor: '0', cumulativeImpairmentMinor: '30000', qtyAtLastValuationMinor: '100', hasOpeningSeq0: false } });
  const seqBInput = (over: Partial<RevalueInput> = {}) => base({
    lots: seqBLots(),
    valuations: seqBValuations(),
    prices: [{ id: 'px-q3-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-09-30', unitPriceMinor: '1200' }],
    decimalsByCoin: { [SUI]: 0 },
    ...over,
  });

  it('IFRS 迴轉：部分處分後 cap 按比例下降，迴轉恰 15000', () => {
    const out = revalueLots(seqBInput());
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', basis: 'IFRS_COST',
      priorCarryingMinor: '35000', currentValueMinor: '50000', deltaMinor: '15000',
      pricePointId: 'px-q3-sui', reason: 'REVERSE',
    })]);
    expect(out.journalEntries).toHaveLength(1);
    expect(out.journalEntries[0].lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '15000', priceRef: 'px-q3-sui' }),
      expect.objectContaining({ account: 'ImpairmentReversalGain', side: 'CREDIT', amountMinor: '15000' }),
    ]);
  });

  // 序列 C：GAAP_COST 同序列 B → 零 JE 零 valuation（no write-up）
  it('GAAP_COST：價回升不迴轉', () => {
    const out = revalueLots(seqBInput({ basis: 'GAAP_COST' }));
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([]);
    expect(out.journalEntries).toEqual([]);
  });

  // 序列 D：迴轉不得使 carrying 超過原成本（價暴漲仍 clamp）。
  // cost=100000、cumImpair=30000（全額，未處分：remainingQty=qtyAtLastValuation）→ carrying=70000。
  // 價暴漲 → value=500000，recovery=430000，但 cap1=cap2=30000 → reversal 頂到 30000，
  // 新 carrying = 70000+30000 = 100000 = 原成本，不再多認列。
  it('IFRS 迴轉頂到原成本上限即停', () => {
    const out = revalueLots(base({
      lots: [{ lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '100', costMinor: '100000' }],
      valuations: { L1: { lotId: 'L1', cumulativeDeltaMinor: '0', cumulativeImpairmentMinor: '30000', qtyAtLastValuationMinor: '100', hasOpeningSeq0: false } },
      prices: [{ id: 'px-spike', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-09-30', unitPriceMinor: '5000' }],
      decimalsByCoin: { [SUI]: 0 },
    }));
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', basis: 'IFRS_COST',
      priorCarryingMinor: '70000', currentValueMinor: '100000', deltaMinor: '30000',
      pricePointId: 'px-spike', reason: 'REVERSE',
    })]);
    expect(out.journalEntries[0].lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '30000' }),
      expect.objectContaining({ account: 'ImpairmentReversalGain', side: 'CREDIT', amountMinor: '30000' }),
    ]);
  });

  // 序列 E（IMPAIR 與 REVERSE 不互抵）：同一 coin 兩個 lot，同一價格點。
  // Lot A：無 prior impairment，cost=100000，value=100×700=70000 < carrying(100000) → IMPAIR 30000。
  // Lot B：有 prior cumulativeImpairment=20000（qtyAtLast=100，未處分）→ attributed=20000，
  //        cost=50000 → carrying=30000；value=100×700=70000 > carrying → recovery=40000，
  //        cap1=cost-carrying=20000，cap2=attributed=20000 → reversal=min(40000,20000,20000)=20000。
  // 若實作誤將 totalImpair 與 totalReverse 相抵（net），這裡的兩對金額（30000 與 20000，不相等）
  // 會被合併成一對，測試必須能抓到。
  it('IFRS：同 coin 內 IMPAIR 與 REVERSE 不互抵，各自成對出現在同一張 JE', () => {
    const px = { id: 'px-mixed-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-09-30', unitPriceMinor: '700' };
    const out = revalueLots(base({
      lots: [
        { lotId: 'LA', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '100', costMinor: '100000' },
        { lotId: 'LB', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '100', costMinor: '50000' },
      ],
      valuations: {
        LB: { lotId: 'LB', cumulativeDeltaMinor: '0', cumulativeImpairmentMinor: '20000', qtyAtLastValuationMinor: '100', hasOpeningSeq0: false },
      },
      prices: [px],
      decimalsByCoin: { [SUI]: 0 },
    }));
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([
      expect.objectContaining({ lotId: 'LA', reason: 'IMPAIR', priorCarryingMinor: '100000', currentValueMinor: '70000', deltaMinor: '-30000' }),
      expect.objectContaining({ lotId: 'LB', reason: 'REVERSE', priorCarryingMinor: '30000', currentValueMinor: '50000', deltaMinor: '20000' }),
    ]);
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.lines).toHaveLength(4);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'ImpairmentLoss', side: 'DEBIT', amountMinor: '30000', leg: 'IMPAIR' }),
      expect.objectContaining({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '30000', leg: 'IMPAIR' }),
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '20000', leg: 'REVERSE' }),
      expect.objectContaining({ account: 'ImpairmentReversalGain', side: 'CREDIT', amountMinor: '20000', leg: 'REVERSE' }),
    ]);
    // 不互抵：兩對金額各自等於各 lot 的 delta 絕對值，總和不會被壓成單一淨額 pair
    const impairAmt = je.lines.filter((l) => l.leg === 'IMPAIR').reduce((s, l) => s + (l.side === 'DEBIT' ? BigInt(l.amountMinor) : 0n), 0n);
    const reverseAmt = je.lines.filter((l) => l.leg === 'REVERSE').reduce((s, l) => s + (l.side === 'DEBIT' ? BigInt(l.amountMinor) : 0n), 0n);
    expect(impairAmt).toBe(30000n);
    expect(reverseAmt).toBe(20000n);
    expect(impairAmt).not.toBe(reverseAmt);
  });
});
