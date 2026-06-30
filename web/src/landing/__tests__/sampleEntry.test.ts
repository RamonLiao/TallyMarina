import { describe, it, expect } from 'vitest';
import { sampleEntry, totals } from '../sampleEntry';

describe('sample journal entry', () => {
  it('is a balanced double-entry (debits === credits)', () => {
    const { debit, credit } = totals(sampleEntry.lines);
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBe(credit);
  });

  it('has at least one debit line and one credit line', () => {
    expect(sampleEntry.lines.some((l) => l.debit > 0)).toBe(true);
    expect(sampleEntry.lines.some((l) => l.credit > 0)).toBe(true);
  });

  it('references a Sui tx digest', () => {
    expect(sampleEntry.txDigest).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});
