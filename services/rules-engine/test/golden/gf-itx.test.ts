import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makeInternalTransferInput } from '../fixtures/internalTransfer.js';

describe('GF-ITX golden (§7.8.3)', () => {
  it('HAPPY: Dr SUI-B 120 / Cr SUI-A 120; lotMovements -40/-120@0xA +40/+120@0xB; no gain', () => {
    const out = evaluate(makeInternalTransferInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.assessment.eventType).toBe('INTERNAL_TRANSFER');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'SUI-B')).toMatchObject({ side: 'DEBIT', amountMinor: '120' });
    expect(je.lines.find((l) => l.account === 'SUI-A')).toMatchObject({ side: 'CREDIT', amountMinor: '120' });
    expect(je.lines.length).toBe(2);
    const mvA = out.lotMovements.find((m) => m.wallet === '0xA');
    const mvB = out.lotMovements.find((m) => m.wallet === '0xB');
    expect(mvA).toMatchObject({ deltaQtyMinor: '-40', deltaCostMinor: '-120' });
    expect(mvB).toMatchObject({ deltaQtyMinor: '40', deltaCostMinor: '120' });
  });

  it('SCOPE: SCOPE_UNKNOWN, no JE', () => {
    const out = evaluate(makeInternalTransferInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('SCOPE_UNKNOWN');
  });

  it('MISSING-PXFX: valuation-independent → POSTABLE, no PRICE_MISSING', () => {
    const out = evaluate(makeInternalTransferInput('MISSING_PXFX'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions.some((e) => e.code === 'PRICE_MISSING')).toBe(false);
  });

  it('INSUFFICIENT-LOT: INSUFFICIENT_LOT, no JE, lot 不變', () => {
    const out = evaluate(makeInternalTransferInput('INSUFFICIENT_LOT'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('INSUFFICIENT_LOT');
    expect(out.lotMovements).toEqual([]);
  });

  it('REPLAY-REVERSAL: replay 0-movement; reversal Dr SUI-A 120 / Cr SUI-B 120', () => {
    const happy = evaluate(makeInternalTransferInput('REPLAY_REVERSAL'));
    const prior = happy.journalEntries[0]!;
    const base = makeInternalTransferInput('REPLAY_REVERSAL');
    const replay = evaluate({
      ...base,
      runContext: { ...base.runContext, mode: 'REPLAY' as const },
      priorJournalEntries: { [prior.idempotencyKey]: prior },
    });
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.lotMovements).toEqual([]);
    const rev = reverse(base, prior);
    expect(rev.lines.find((l) => l.account === 'SUI-A')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'SUI-B')!.side).toBe('CREDIT');
  });

  it('GF-ITX-ENTITY-BOUNDARY: counterparty null → ENTITY_BOUNDARY, REJECTED, no JE', () => {
    const inp = makeInternalTransferInput('HAPPY');
    (inp.event as { counterparty: string | null }).counterparty = null;
    const out = evaluate(inp);
    expect(out.decision).toBe('REJECTED');
    expect(out.exceptions[0]).toMatchObject({ phase: 2, code: 'ENTITY_BOUNDARY' });
    expect(out.journalEntries).toEqual([]);
  });

  it('GF-ITX-SAME-WALLET-COA: srcAcct === dstAcct → zero-value JE, no lines, lot still moves', () => {
    const inp = makeInternalTransferInput('SAME_WALLET_COA');
    const out = evaluate(inp);
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions).toEqual([]);
    const je = out.journalEntries[0]!;
    expect(je.lines).toEqual([]);
    const mvA = out.lotMovements.find((m) => m.wallet === '0xA');
    const mvB = out.lotMovements.find((m) => m.wallet === '0xB');
    expect(mvA).toMatchObject({ deltaQtyMinor: '-40', deltaCostMinor: '-120' });
    expect(mvB).toMatchObject({ deltaQtyMinor: '40', deltaCostMinor: '120' });
  });

  it('GF-ITX-MISSING-PXFX-STRONG: explicit empty prices/fxRates → POSTABLE, no PRICE_MISSING, JE balanced', () => {
    const out = evaluate(makeInternalTransferInput('MISSING_PXFX'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions.some((e) => e.code === 'PRICE_MISSING')).toBe(false);
    expect(out.exceptions.some((e) => e.code === 'FX_MISSING')).toBe(false);
    const je = out.journalEntries[0]!;
    const drTotal = je.lines
      .filter((l) => l.side === 'DEBIT')
      .reduce((sum, l) => sum + BigInt(l.amountMinor), 0n);
    const crTotal = je.lines
      .filter((l) => l.side === 'CREDIT')
      .reduce((sum, l) => sum + BigInt(l.amountMinor), 0n);
    expect(drTotal).toBe(crTotal);
  });
});
