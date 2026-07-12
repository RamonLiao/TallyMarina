import { describe, it, expect } from 'vitest';
import { revalueLots } from '../src/revaluation/revalue.js';
import type { RevalueInput, ValuationState } from '../src/revaluation/types.js';

const SUI = '0x2::sui::SUI';
const lot1 = { lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' }; // 1 SUI @ cost $1,000.00

const base = (over: Partial<RevalueInput> = {}): RevalueInput => ({
  basis: 'GAAP_FV', entityId: 'e1', periodId: '2026-Q2', keyBase: 'e1:2026-Q2:1',
  lots: [lot1],
  valuations: {},
  prices: [{ id: 'px-q2-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '140000' }], // $1,400/SUI
  decimalsByCoin: { [SUI]: 9 },
  policySetVersion: 'ps-v1', ...over,
});

describe('revalueLots ASU 2023-08 transition', () => {
  it('雙向（升值）：cost 100000 / opening_fv 140000 → Cr RetainedEarnings 40000', () => {
    const out = revalueLots(base({ transitionMode: true }));
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', seq: 0, reason: 'OPENING_FV',
      priorCarryingMinor: '100000', currentValueMinor: '140000', deltaMinor: '40000',
    })]);
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.idempotencyKey).toBe(`reval-open:e1:${SUI}`);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '40000' }),
      expect.objectContaining({ account: 'RetainedEarnings', side: 'CREDIT', amountMinor: '40000' }),
    ]);
  });

  it('雙向（貶值）：cost 100000 / opening_fv 70000 → Dr RetainedEarnings 30000', () => {
    const out = revalueLots(base({
      transitionMode: true,
      prices: [{ id: 'px', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '70000' }],
    }));
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.idempotencyKey).toBe(`reval-open:e1:${SUI}`);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'RetainedEarnings', side: 'DEBIT', amountMinor: '30000' }),
      expect.objectContaining({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '30000' }),
    ]);
  });

  it('兩段分離（同一 run，期末價 = opening 價）：過渡 JE 有、重估 JE 無', () => {
    const out = revalueLots(base({ transitionMode: true }));
    // 只有一張 JE，key 是 reval-open:，沒有 reval: 前綴的重估 JE
    expect(out.journalEntries).toHaveLength(1);
    expect(out.journalEntries[0].idempotencyKey).toBe(`reval-open:e1:${SUI}`);
    expect(out.journalEntries.find(j => j.idempotencyKey.startsWith('reval:'))).toBeUndefined();
    // valuations 只有 OPENING_FV draft，沒有 REVALUE draft（segment2 delta=0）
    expect(out.valuations).toHaveLength(1);
    expect(out.valuations[0].reason).toBe('OPENING_FV');
  });

  it('兩段分離（跨期）：期末價再漲 → 過渡 JE（第一期）+ 重估 JE（第二期）各一張，重估 delta 只含 期末－opening_fv', () => {
    // 第一期：transition run，價 1400/SUI → opening_fv=140000
    const out1 = revalueLots(base({ transitionMode: true }));
    expect(out1.journalEntries).toHaveLength(1);
    expect(out1.journalEntries[0].idempotencyKey).toBe(`reval-open:e1:${SUI}`);
    const openingDraft = out1.valuations.find(v => v.reason === 'OPENING_FV')!;
    expect(openingDraft.currentValueMinor).toBe('140000');

    // 模擬 api fold 後的第二期 valuations 狀態：hasOpeningSeq0=true，cumulativeDelta = opening_fv - cost
    const foldedValuations: Record<string, ValuationState> = {
      L1: {
        lotId: 'L1',
        cumulativeDeltaMinor: openingDraft.deltaMinor, // 40000
        cumulativeImpairmentMinor: '0',
        qtyAtLastValuationMinor: lot1.remainingQtyMinor,
        hasOpeningSeq0: true,
      },
    };
    // 第二期：期末價漲到 2000/SUI → current=200000
    const out2 = revalueLots(base({
      transitionMode: true, // 仍可傳 true，因 hasOpeningSeq0 已 true 應冪等跳過過渡段
      valuations: foldedValuations,
      prices: [{ id: 'px-q3-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-09-30', unitPriceMinor: '200000' }],
    }));
    expect(out2.journalEntries.find(j => j.idempotencyKey.startsWith('reval-open:'))).toBeUndefined();
    expect(out2.journalEntries).toHaveLength(1);
    const revalJe = out2.journalEntries[0];
    expect(revalJe.idempotencyKey).toBe(`reval:e1:2026-Q2:1:${SUI}`);
    // delta = 200000 - 140000 = 60000（不是 200000-100000）
    expect(revalJe.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '60000' }),
      expect.objectContaining({ account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: '60000' }),
    ]);
    const revalDraft = out2.valuations.find(v => v.reason === 'REVALUE')!;
    expect(revalDraft.priorCarryingMinor).toBe('140000');
    expect(revalDraft.currentValueMinor).toBe('200000');
    expect(revalDraft.deltaMinor).toBe('60000');
  });

  it('冪等：hasOpeningSeq0=true 時即使 transitionMode=true 也不再出過渡 JE/draft', () => {
    const foldedValuations: Record<string, ValuationState> = {
      L1: {
        lotId: 'L1',
        cumulativeDeltaMinor: '0',
        cumulativeImpairmentMinor: '0',
        qtyAtLastValuationMinor: lot1.remainingQtyMinor,
        hasOpeningSeq0: true,
      },
    };
    // 價 = cost 對應值（100000），baseline = cost + 0 = 100000 → delta 0，segment2 也不出東西
    const out = revalueLots(base({
      transitionMode: true,
      valuations: foldedValuations,
      prices: [{ id: 'px', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '100000' }],
    }));
    expect(out.journalEntries).toEqual([]);
    expect(out.valuations).toEqual([]);
    expect(out.journalEntries.find(j => j.idempotencyKey.startsWith('reval-open:'))).toBeUndefined();
    expect(out.valuations.find(v => v.reason === 'OPENING_FV')).toBeUndefined();
  });

  it('同 coin 混合 lot（一個已過渡、一個未過渡）：過渡 JE 只含新 lot、重估 JE 只含已過渡 lot 的 delta', () => {
    // L1 已過渡：carrying = 100000 + 40000 = 140000；L2 新 lot：cost 250000, 2 SUI
    const out = revalueLots(base({
      transitionMode: true,
      lots: [
        lot1,
        { lotId: 'L2', seq: 2, coinType: SUI, wallet: 'w1', remainingQtyMinor: '2000000000', costMinor: '250000' },
      ],
      valuations: {
        L1: { lotId: 'L1', cumulativeDeltaMinor: '40000', cumulativeImpairmentMinor: '0', qtyAtLastValuationMinor: '1000000000', hasOpeningSeq0: true },
      },
      prices: [{ id: 'px-mix', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '150000' }], // $1,500/SUI
    }));
    expect(out.exceptions).toEqual([]);
    // 過渡：只有 L2 → opening_fv 300000 − cost 250000 = +50000 → Cr RetainedEarnings 50000
    const openJe = out.journalEntries.find(j => j.idempotencyKey === `reval-open:e1:${SUI}`)!;
    expect(openJe.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '50000' }),
      expect.objectContaining({ account: 'RetainedEarnings', side: 'CREDIT', amountMinor: '50000' }),
    ]);
    // 重估：只有 L1（150000 − 140000 = +10000）；L2 baseline 已是 opening_fv → delta 0 不進重估 JE
    const revalJe = out.journalEntries.find(j => j.idempotencyKey === `reval:e1:2026-Q2:1:${SUI}`)!;
    expect(revalJe.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '10000' }),
      expect.objectContaining({ account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: '10000' }),
    ]);
    expect(out.journalEntries).toHaveLength(2);
    // drafts：L1 一列 REVALUE + L2 一列 OPENING_FV（seq 0）；L1 不得有 OPENING_FV
    expect(out.valuations).toEqual([
      expect.objectContaining({ lotId: 'L1', reason: 'REVALUE', deltaMinor: '10000' }),
      expect.objectContaining({ lotId: 'L2', reason: 'OPENING_FV', seq: 0, deltaMinor: '50000' }),
    ]);
  });

  it('跨 coin 過渡：netOpenDelta per-coin 分開，各 coin 各出一張 reval-open JE', () => {
    const USDC = '0x2::usdc::USDC';
    const out = revalueLots(base({
      transitionMode: true,
      lots: [
        lot1, // SUI: opening_fv 140000 − cost 100000 = +40000
        { lotId: 'L3', seq: 1, coinType: USDC, wallet: 'w1', remainingQtyMinor: '1000000', costMinor: '150000' }, // 1 USDC, opening_fv 120000 → −30000
      ],
      prices: [
        { id: 'px-q2-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '140000' },
        { id: 'px-q2-usdc', coinType: USDC, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '120000' },
      ],
      decimalsByCoin: { [SUI]: 9, [USDC]: 6 },
    }));
    expect(out.exceptions).toEqual([]);
    expect(out.journalEntries).toHaveLength(2);
    const suiJe = out.journalEntries.find(j => j.idempotencyKey === `reval-open:e1:${SUI}`)!;
    expect(suiJe.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '40000' }),
      expect.objectContaining({ account: 'RetainedEarnings', side: 'CREDIT', amountMinor: '40000' }),
    ]);
    const usdcJe = out.journalEntries.find(j => j.idempotencyKey === `reval-open:e1:${USDC}`)!;
    expect(usdcJe.lines).toEqual([
      expect.objectContaining({ account: 'RetainedEarnings', side: 'DEBIT', amountMinor: '30000' }),
      expect.objectContaining({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '30000' }),
    ]);
  });
});
