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

  it('LOSS: carrying(20) > FV(8) → DISPOSAL_LOSS DEBIT 12; JE balances', () => {
    // lot carrying=20, FV=2*4=8 → loss=12
    // Dr NET-FEE 8 / Dr DISPOSAL_LOSS 12 / Cr ASSET-SUI 20
    const inp = makeGasInput('HAPPY');
    inp.lots = [{ lotId: 'LOT-GAS1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '2', costMinor: '20' }];
    const out = evaluate(inp);
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    const lossLine = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS');
    expect(lossLine).toMatchObject({ side: 'DEBIT', amountMinor: '12' });
    const drTotal = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });

  it('REPLAY-REVERSAL: replay 回原 JE; reversal Dr ASSET-SUI / Dr GAIN / Cr NET-FEE; lot negated', () => {
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
    const { je: rev, lotMovements } = reverse(base, prior, happy.lotMovements);
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'NET-FEE')!.side).toBe('CREDIT');
    expect(rev.lines.find((l) => l.account === 'GAIN')!.side).toBe('DEBIT');
    // lot negation: original -2/-5 → reversal +2/+5
    expect(lotMovements[0]).toMatchObject({ deltaQtyMinor: '2', deltaCostMinor: '5' });
    expect(lotMovements).toEqual(happy.lotMovements.map((m) => ({ ...m, deltaQtyMinor: String(-BigInt(m.deltaQtyMinor)), deltaCostMinor: String(-BigInt(m.deltaCostMinor)) })));
  });
});
