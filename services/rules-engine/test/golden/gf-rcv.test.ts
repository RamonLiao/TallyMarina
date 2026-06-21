import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('GF-RCV golden fixtures (§7.8.1)', () => {
  it('GF-RCV-HAPPY: Dr SUI 300 / Cr AR 300; +lot 100/300; acquisition fact; no exception; priceRef present', () => {
    const out = evaluate(makeReceiptInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions).toEqual([]);
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.side === 'DEBIT')!.amountMinor).toBe('300');
    expect(je.lines.find((l) => l.side === 'CREDIT')!.amountMinor).toBe('300');
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '100', deltaCostMinor: '300' });
    expect(out.disclosureFacts[0]!.kind).toBe('acquisition');
    // F4: valued event → priceRefs non-empty
    expect(out.explanation.priceRefs.length).toBeGreaterThan(0);
  });

  it('GF-RCV-SCOPE: no JE; SCOPE_UNKNOWN; REVIEW_REQUIRED', () => {
    const out = evaluate(makeReceiptInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.decision).toBe('REVIEW_REQUIRED');
    expect(out.exceptions[0]).toMatchObject({ phase: 4, code: 'SCOPE_UNKNOWN' });
  });

  it('GF-RCV-MISSING-PXFX: no JE; PRICE_MISSING or FX_MISSING', () => {
    const noPrice = evaluate(makeReceiptInput('NO_PRICE'));
    expect(noPrice.journalEntries).toEqual([]);
    expect(noPrice.exceptions[0]!.code).toBe('PRICE_MISSING');
    const noFx = evaluate(makeReceiptInput('NO_FX'));
    expect(noFx.exceptions[0]!.code).toBe('FX_MISSING');
  });

  it('GF-RCV-INSUFFICIENT-LOT: same as happy; receipt 不消耗 lot; assert no INSUFFICIENT_LOT', () => {
    // why: receipt 永不跑 FIFO 消耗；誤加消耗會在此 fixture 報 shortage → 必 fail
    const out = evaluate(makeReceiptInput('INSUFFICIENT_LOT'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions.some((e) => e.code === 'INSUFFICIENT_LOT')).toBe(false);
    expect(out.lotMovements.every((m) => BigInt(m.deltaQtyMinor) >= 0n)).toBe(true);
  });

  it('GF-RCV-REPLAY-REVERSAL: replay 回原 JE; reversal Dr AR 300 / Cr SUI 300, lineage 指回 prior; lot negated', () => {
    const happy = evaluate(makeReceiptInput('HAPPY'));
    const priorJe = happy.journalEntries[0]!;
    const replayBase = makeReceiptInput('HAPPY');
    const replayInput = { ...replayBase, runContext: { ...replayBase.runContext, mode: 'REPLAY' as const }, priorJournalEntries: { [priorJe.idempotencyKey]: priorJe } };
    const replay = evaluate(replayInput);
    expect(replay.journalEntries[0]!.idempotencyKey).toBe(priorJe.idempotencyKey);
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');

    const { je: rev, lotMovements } = reverse(makeReceiptInput('HAPPY'), priorJe, happy.lotMovements);
    expect(rev.reversalOf).toBe(priorJe.idempotencyKey);
    // 原 Dr ASSET / Cr AR → reversal Cr ASSET / Dr AR
    expect(rev.lines.find((l) => l.account === 'AR')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('CREDIT');
    // lot negation: original +100/+300 → reversal -100/-300
    expect(lotMovements).toEqual(happy.lotMovements.map((m) => ({ ...m, deltaQtyMinor: String(-BigInt(m.deltaQtyMinor)), deltaCostMinor: String(-BigInt(m.deltaCostMinor)) })));
    expect(lotMovements[0]).toMatchObject({ deltaQtyMinor: '-100', deltaCostMinor: '-300' });
  });
});
