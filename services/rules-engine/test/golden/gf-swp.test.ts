import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/index.js';
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
});
