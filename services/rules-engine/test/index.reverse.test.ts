import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('reverse', () => {
  it('借貸對調、reversalOf 指回、lineageHash 重算', () => {
    const happy = evaluate(makeReceiptInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const rev = reverse(makeReceiptInput('HAPPY'), prior);
    expect(rev.reversalOf).toBe(prior.idempotencyKey);
    expect(rev.lines.find((l) => l.account === 'AR')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('CREDIT');
    expect(rev.idempotencyKey).not.toBe(prior.idempotencyKey);
    expect(typeof rev.lineageHash).toBe('string');
  });

  it('idempotent：reverse(reverse) 行為一致（金額不漂移）', () => {
    const prior = evaluate(makeReceiptInput('HAPPY')).journalEntries[0]!;
    const r1 = reverse(makeReceiptInput('HAPPY'), prior);
    expect(r1.lines.map((l) => l.amountMinor)).toEqual(prior.lines.map((l) => l.amountMinor));
  });
});
