import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import type { RuleInput, CoaMapping, PositionLot } from '../src/domain/types.js';

// §4.5（spec 2026-07-12-remeasurement-dual-track-design）、CPA B1：處分吃重估後 carrying。
// coa 額外收錄 reclass legs（UNREALIZED_GAIN_RECLASS / UNREALIZED_LOSS_RECLASS）供 GAAP_FV 重分類斷言。
const coa: CoaMapping = {
  resolve: ({ leg }) =>
    ({
      ACQUISITION: 'ASSET-USDC',
      DISPOSAL: 'ASSET-SUI',
      DISPOSAL_GAIN: 'DisposalGain',
      DISPOSAL_LOSS: 'DisposalLoss',
      UNREALIZED_GAIN_RECLASS: 'UnrealizedGainCryptoPnL',
      UNREALIZED_LOSS_RECLASS: 'UnrealizedLossCryptoPnL',
    }[leg] ?? null),
};

function makeInput(lot: PositionLot, considerationQtyMinor: string, quantityMinor: string): RuleInput {
  return {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-30T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'swp-reval', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
      coinType: lot.coinType, assetDecimals: 0, quantityMinor,
      eventTime: '2026-06-30T00:00:00Z', economicPurpose: 'SPOT_TRADE_SWAP',
      ownershipChange: true,
      considerationAsset: '0x2::usdc::USDC',
      considerationQtyMinor,
      considerationDecimals: 0,
      rawPayloadHash: 'raw', txDigest: 'dig', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
    },
    assetAssessment: { coinType: lot.coinType, status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [lot],
    prices: [{ id: 'PX-USDC', coinType: '0x2::usdc::USDC', priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '1' }],
    fxRates: [],
    coaMapping: coa,
  };
}

describe('§4.5 處分吃重估後 carrying（CPA B1）', () => {
  it('GAAP_FV：cost 100000, delta +40000 (carrying 140000), 售 150000 → Cr DigitalAssets 140000, 累計損益(reclass後)恰 50000, 無殘留', () => {
    const lot: PositionLot = {
      lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA',
      remainingQtyMinor: '100', costMinor: '100000',
      // CPA B1's 40000 is entirely period-reval (P&L) delta, no ASU-transition component —
      // valuationPnlDeltaMinor === valuationDeltaMinor in this fixture (see the mixed-source
      // test below for the case where they diverge).
      valuationDeltaMinor: '40000', valuationPnlDeltaMinor: '40000',
    };
    const out = evaluate(makeInput(lot, '150000', '100'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;

    const disp = je.lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ account: 'ASSET-SUI', side: 'CREDIT', amountMinor: '140000' });

    const mainGain = je.lines.find((l) => l.leg === 'DISPOSAL_GAIN');
    expect(mainGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '10000' }); // 150000-140000

    const reclassUnreal = je.lines.find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS');
    expect(reclassUnreal).toMatchObject({ account: 'UnrealizedGainCryptoPnL', side: 'DEBIT', amountMinor: '40000' });
    const reclassGain = je.lines.find((l) => l.leg === 'DISPOSAL_GAIN_RECLASS');
    expect(reclassGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '40000' });

    // 累計損益 = DisposalGain 帳戶淨額（main + reclass）恰 50000 = 對價(150000) - 原成本(100000)
    const disposalGainTotal = je.lines
      .filter((l) => l.account === 'DisposalGain')
      .reduce((s, l) => s + (l.side === 'CREDIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)), 0n);
    expect(disposalGainTotal).toBe(50000n);

    // Unrealized 帳戶淨額歸零（40000 reval credit 之後未入本 JE；本 JE 只有這筆 debit 40000，
    // 驗證 reclass 出的金額恰等於先前重估認列的 delta，供上層測試把兩張 JE 疊加得到 0）
    expect(reclassUnreal!.amountMinor).toBe('40000');

    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('IFRS/GAAP_COST：cost 100000, impair 30000 (carrying 70000), 售 75000 → 損益 +5000（非 -25000）, Cr DigitalAssets 70000, 無重分類 line', () => {
    const lot: PositionLot = {
      lotId: 'LOT2', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA',
      remainingQtyMinor: '100', costMinor: '100000', valuationImpairMinor: '30000',
    };
    const out = evaluate(makeInput(lot, '75000', '100'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;

    const disp = je.lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ account: 'ASSET-SUI', side: 'CREDIT', amountMinor: '70000' });

    const gain = je.lines.find((l) => l.leg === 'DISPOSAL_GAIN');
    expect(gain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '5000' });

    expect(je.lines.find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS')).toBeUndefined();
    expect(je.lines.find((l) => l.leg === 'UNREALIZED_LOSS_RECLASS')).toBeUndefined();
    expect(je.lines.find((l) => l.leg === 'DISPOSAL_GAIN_RECLASS')).toBeUndefined();
    expect(je.lines.find((l) => l.leg === 'DISPOSAL_LOSS_RECLASS')).toBeUndefined();

    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('GAAP_FV loss 對稱：delta -20000 (carrying 80000), 售 60000 → Dr DisposalLoss(主) 20000 + Dr DisposalLoss(reclass) 20000 / Cr UnrealizedLossCryptoPnL 20000', () => {
    const lot: PositionLot = {
      lotId: 'LOT3', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA',
      remainingQtyMinor: '100', costMinor: '100000',
      valuationDeltaMinor: '-20000', valuationPnlDeltaMinor: '-20000',
    };
    const out = evaluate(makeInput(lot, '60000', '100'));
    const je = out.journalEntries[0]!;
    const disp = je.lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ account: 'ASSET-SUI', side: 'CREDIT', amountMinor: '80000' }); // 100000-20000

    const mainLoss = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS');
    expect(mainLoss).toMatchObject({ account: 'DisposalLoss', side: 'DEBIT', amountMinor: '20000' }); // 80000-60000

    const reclassLoss = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS_RECLASS');
    expect(reclassLoss).toMatchObject({ account: 'DisposalLoss', side: 'DEBIT', amountMinor: '20000' });
    const reclassUnreal = je.lines.find((l) => l.leg === 'UNREALIZED_LOSS_RECLASS');
    expect(reclassUnreal).toMatchObject({ account: 'UnrealizedLossCryptoPnL', side: 'CREDIT', amountMinor: '20000' });

    // 累計損益 = 對價(60000) - 原成本(100000) = -40000
    const disposalLossTotal = je.lines
      .filter((l) => l.account === 'DisposalLoss')
      .reduce((s, l) => s + (l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)), 0n);
    expect(disposalLossTotal).toBe(40000n);

    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('部分處分 50%：qty 100 → 消耗 50，delta +40000 攤出 20000（floor)', () => {
    const lot: PositionLot = {
      lotId: 'LOT4', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA',
      remainingQtyMinor: '100', costMinor: '100000',
      valuationDeltaMinor: '40000', valuationPnlDeltaMinor: '40000',
    };
    // 消耗 50/100：cost floor(100000*50/100)=50000；delta floor(40000*50/100)=20000 → carrying=70000
    const out = evaluate(makeInput(lot, '75000', '50'));
    const je = out.journalEntries[0]!;
    const disp = je.lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ amountMinor: '70000' });
    const reclassUnreal = je.lines.find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS');
    expect(reclassUnreal).toMatchObject({ amountMinor: '20000' });

    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('external review fix: mixed ASU-transition (equity, 20000) + period (P&L, 20000) delta → reclass ONLY the P&L 20000, never the equity 20000', () => {
    // valuationDeltaMinor (carrying) = 40000 (20000 transition + 20000 period), but
    // valuationPnlDeltaMinor (reclass-eligible) = only 20000 — the transition half was booked
    // straight to RetainedEarnings and must never flow through UnrealizedGainCryptoPnL/
    // DisposalGain. Regression pin for the external-review blocker (see swapRules.ts's
    // revaluedCarrying comment).
    const lot: PositionLot = {
      lotId: 'LOT6', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA',
      remainingQtyMinor: '100', costMinor: '100000',
      valuationDeltaMinor: '40000', valuationPnlDeltaMinor: '20000',
    };
    const out = evaluate(makeInput(lot, '150000', '100'));
    const je = out.journalEntries[0]!;

    const disp = je.lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ account: 'ASSET-SUI', side: 'CREDIT', amountMinor: '140000' }); // carrying still uses FULL 40000

    const mainGain = je.lines.find((l) => l.leg === 'DISPOSAL_GAIN');
    expect(mainGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '10000' }); // 150000-140000

    // Reclass amount is the P&L-only 20000, NOT the full 40000.
    const reclassUnreal = je.lines.find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS');
    expect(reclassUnreal).toMatchObject({ account: 'UnrealizedGainCryptoPnL', side: 'DEBIT', amountMinor: '20000' });
    const reclassGain = je.lines.find((l) => l.leg === 'DISPOSAL_GAIN_RECLASS');
    expect(reclassGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '20000' });

    // DisposalGain nets to 30000 (10000 main + 20000 reclass), NOT 50000 (proceeds - cost) —
    // the equity-sourced 20000 was already recognized in RetainedEarnings by the transition
    // JE (a prior, separate JE this test doesn't model) and correctly never touches DisposalGain.
    const disposalGainTotal = je.lines
      .filter((l) => l.account === 'DisposalGain')
      .reduce((s, l) => s + (l.side === 'CREDIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)), 0n);
    expect(disposalGainTotal).toBe(30000n); // 10000 main + 20000 reclass — NOT 50000 (that would double the equity 20000)

    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('無 valuation 欄的 lot → 行為與現狀 byte-identical（回歸鎖）：無 reclass line', () => {
    const lot: PositionLot = { lotId: 'LOT5', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '100', costMinor: '200' };
    const out = evaluate(makeInput(lot, '300', '100'));
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'ASSET-USDC')).toMatchObject({ side: 'DEBIT', amountMinor: '300' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '200' });
    expect(je.lines.find((l) => l.account === 'DisposalGain')).toMatchObject({ side: 'CREDIT', amountMinor: '100' });
    expect(je.lines.some((l) => l.leg?.includes('RECLASS'))).toBe(false);
    expect(je.lines).toHaveLength(3);
  });
});
