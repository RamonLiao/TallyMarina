import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makeGasInput } from '../fixtures/gas.js';

describe('GF-GAS golden (§7.8.5)', () => {
  it('HAPPY: Dr NET-FEE 8 / Cr ASSET-SUI 5 / Cr GAIN 3; FIFO -2/-5', () => {
    const out = evaluate(makeGasInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.assessment.eventType).toBe('GAS_FEE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'NET-FEE')).toMatchObject({ side: 'DEBIT', amountMinor: '8' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '5' });
    expect(je.lines.find((l) => l.account === 'GAIN')).toMatchObject({ side: 'CREDIT', amountMinor: '3' });
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '-2', deltaCostMinor: '-5' });
  });

  it('SCOPE: SCOPE_UNKNOWN, no JE', () => {
    const out = evaluate(makeGasInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('SCOPE_UNKNOWN');
  });

  it('MISSING-PXFX: PRICE_MISSING / FX_MISSING', () => {
    expect(evaluate(makeGasInput('NO_PRICE')).exceptions[0]!.code).toBe('PRICE_MISSING');
    expect(evaluate(makeGasInput('NO_FX')).exceptions[0]!.code).toBe('FX_MISSING');
  });

  it('INSUFFICIENT-LOT: INSUFFICIENT_LOT, no JE, lot 不變', () => {
    const out = evaluate(makeGasInput('INSUFFICIENT_LOT'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('INSUFFICIENT_LOT');
    expect(out.lotMovements).toEqual([]);
  });

  it('REPLAY-REVERSAL: replay 回原 JE; reversal Dr ASSET-SUI / Dr GAIN / Cr NET-FEE', () => {
    const happy = evaluate(makeGasInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const base = makeGasInput('HAPPY');
    const replay = evaluate({
      ...base,
      runContext: { ...base.runContext, mode: 'REPLAY' as const },
      priorJournalEntries: { [prior.idempotencyKey]: prior },
    });
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.lotMovements).toEqual([]);
    const rev = reverse(base, prior);
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'NET-FEE')!.side).toBe('CREDIT');
    expect(rev.lines.find((l) => l.account === 'GAIN')!.side).toBe('DEBIT');
  });
});
