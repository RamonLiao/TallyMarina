import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makeSwapInput } from '../fixtures/swap.js';

describe('GF-SWP golden (§7.8.4)', () => {
  it('GF-SWP-01 HAPPY: Dr USDC 300 / Cr SUI 200 / Cr GAIN 100; lotMovements SUI -100/-200 + USDC +300/+300', () => {
    const out = evaluate(makeSwapInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.assessment.eventType).toBe('SPOT_TRADE_SWAP');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'ASSET-USDC')).toMatchObject({ side: 'DEBIT', amountMinor: '300' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '200' });
    expect(je.lines.find((l) => l.account === 'GAIN')).toMatchObject({ side: 'CREDIT', amountMinor: '100' });
    const suiMov = out.lotMovements.find((m) => m.coinType === '0x2::sui::SUI');
    expect(suiMov).toMatchObject({ deltaQtyMinor: '-100', deltaCostMinor: '-200' });
    const usdcMov = out.lotMovements.find((m) => m.coinType === '0x2::usdc::USDC');
    expect(usdcMov).toMatchObject({ deltaQtyMinor: '300', deltaCostMinor: '300' });
  });

  it('GF-SWP-02 SCOPE: SCOPE_UNKNOWN, no JE', () => {
    const out = evaluate(makeSwapInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('SCOPE_UNKNOWN');
  });

  it('GF-SWP-03 MISSING-PRICE: PRICE_MISSING', () => {
    const out = evaluate(makeSwapInput('NO_PRICE'));
    expect(out.exceptions[0]!.code).toBe('PRICE_MISSING');
  });

  it('GF-SWP-04 MISSING-FX: FX_MISSING', () => {
    const out = evaluate(makeSwapInput('NO_FX'));
    expect(out.exceptions[0]!.code).toBe('FX_MISSING');
  });

  it('GF-SWP-05 INSUFFICIENT-LOT: INSUFFICIENT_LOT, no JE', () => {
    const out = evaluate(makeSwapInput('INSUFFICIENT_LOT'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('INSUFFICIENT_LOT');
    expect(out.lotMovements).toEqual([]);
  });

  it('GF-SWP-06 LOSS: carrying(200) > FV(150) → DISPOSAL_LOSS DEBIT 50; JE balances', () => {
    // SUI lot carrying=200, consideration FV=150 → loss=50
    // Dr USDC 150 / Dr DISPOSAL_LOSS 50 / Cr ASSET-SUI 200
    const inp = makeSwapInput('HAPPY');
    inp.lots = [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '100', costMinor: '200' }];
    // consideration FV: 300 USDC * unitPrice 0.5 = 150 (override price)
    inp.prices = [{ id: 'PX-USDC', coinType: '0x2::usdc::USDC', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '1' }];
    // considerationQtyMinor=150 → FV=150
    (inp.event as { considerationQtyMinor: string }).considerationQtyMinor = '150';
    const out = evaluate(inp);
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    const lossLine = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS');
    expect(lossLine).toMatchObject({ side: 'DEBIT', amountMinor: '50' });
    // JE balance: DEBIT total === CREDIT total
    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('GF-SWP-REPLAY-REVERSAL: replay回原JE; reversal Dr SUI/GAIN / Cr USDC', () => {
    const happy = evaluate(makeSwapInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const base = makeSwapInput('HAPPY');
    const replay = evaluate({
      ...base,
      runContext: { ...base.runContext, mode: 'REPLAY' as const },
      priorJournalEntries: { [prior.idempotencyKey]: prior },
    });
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.lotMovements).toEqual([]);
    const rev = reverse(base, prior);
    expect(rev.lines.find((l) => l.account === 'ASSET-USDC')!.side).toBe('CREDIT');
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'GAIN')!.side).toBe('DEBIT');
    expect(rev.reversalOf).toBe(prior.idempotencyKey);
  });
});
