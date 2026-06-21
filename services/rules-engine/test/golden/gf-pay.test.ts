import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makePaymentInput } from '../fixtures/payment.js';

describe('GF-PAY golden (§7.8.2)', () => {
  it('HAPPY: Dr SVC-EXP 80 / Cr ASSET-SUI 50 / Cr GAIN 30; FIFO -20/-50', () => {
    const out = evaluate(makePaymentInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.assessment.eventType).toBe('DIGITAL_ASSET_PAYMENT');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'SVC-EXP')).toMatchObject({ side: 'DEBIT', amountMinor: '80' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '50' });
    expect(je.lines.find((l) => l.account === 'GAIN')).toMatchObject({ side: 'CREDIT', amountMinor: '30' });
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '-20', deltaCostMinor: '-50' });
  });

  it('SCOPE: SCOPE_UNKNOWN, no JE', () => {
    const out = evaluate(makePaymentInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('SCOPE_UNKNOWN');
  });

  it('MISSING-PXFX: PRICE_MISSING / FX_MISSING', () => {
    expect(evaluate(makePaymentInput('NO_PRICE')).exceptions[0]!.code).toBe('PRICE_MISSING');
    expect(evaluate(makePaymentInput('NO_FX')).exceptions[0]!.code).toBe('FX_MISSING');
  });

  it('INSUFFICIENT-LOT: INSUFFICIENT_LOT, no JE, lot 不變', () => {
    const out = evaluate(makePaymentInput('INSUFFICIENT_LOT'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('INSUFFICIENT_LOT');
    expect(out.lotMovements).toEqual([]);
  });

  it('REPLAY-REVERSAL: replay 回原 JE; reversal Dr ASSET-SUI / Dr GAIN / Cr SVC-EXP', () => {
    const happy = evaluate(makePaymentInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const base = makePaymentInput('HAPPY');
    const replay = evaluate({
      ...base,
      runContext: { ...base.runContext, mode: 'REPLAY' as const },
      priorJournalEntries: { [prior.idempotencyKey]: prior },
    });
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.lotMovements).toEqual([]);
    const rev = reverse(base, prior);
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'SVC-EXP')!.side).toBe('CREDIT');
    expect(rev.lines.find((l) => l.account === 'GAIN')!.side).toBe('DEBIT');
  });
});
