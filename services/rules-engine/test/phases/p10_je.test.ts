import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/index.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('phase 10-12 evaluate (happy)', () => {
  it('GF-RCV-HAPPY: Dr SUI asset 300 / Cr AR 300, balanced, POSTABLE', () => {
    const out = evaluate(makeReceiptInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    const debits = je.lines.filter((l) => l.side === 'DEBIT');
    const credits = je.lines.filter((l) => l.side === 'CREDIT');
    expect(debits[0]).toMatchObject({ amountMinor: '300' });
    expect(credits[0]).toMatchObject({ amountMinor: '300', leg: 'RECEIVABLE_SETTLEMENT' });
    expect(je.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
