import { describe, it, expect } from 'vitest';
import { trialActivity, ImbalanceError } from './trialActivity';
import type { JournalLine } from '../api/types';

const L = (account: string, side: 'DEBIT' | 'CREDIT', amountMinor: string): JournalLine =>
  ({ account, side, amountMinor, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'X' });

describe('trialActivity', () => {
  it('sums per account and reports balanced totals', () => {
    const r = trialActivity([L('asset', 'DEBIT', '1000'), L('ar', 'CREDIT', '1000')]);
    expect(r.totalDebitMinor).toBe(1000n);
    expect(r.totalCreditMinor).toBe(1000n);
    expect(r.rows.find((x) => x.account === 'asset')!.debitMinor).toBe(1000n);
  });

  it('aggregates multiple legs on the same account', () => {
    const r = trialActivity([L('asset', 'DEBIT', '600'), L('asset', 'DEBIT', '400'), L('ar', 'CREDIT', '1000')]);
    expect(r.rows.find((x) => x.account === 'asset')!.debitMinor).toBe(1000n);
  });

  it('THROWS ImbalanceError when debits != credits (WHY: an unbalanced export is corrupt evidence)', () => {
    try {
      trialActivity([L('asset', 'DEBIT', '1000'), L('ar', 'CREDIT', '999')]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ImbalanceError);
      expect((e as ImbalanceError).debit).toBe(1000n);
      expect((e as ImbalanceError).credit).toBe(999n);
    }
  });

  it('THROWS on a negative amount (WHY: direction is carried by side; negatives corrupt ERP import)', () => {
    expect(() => trialActivity([L('asset', 'DEBIT', '-5'), L('ar', 'CREDIT', '-5')]))
      .toThrow(/non-negative|negative/i);
  });

  // WHY: BigInt('') silently returns 0n (NOT a SyntaxError) — the guard prevents this silent-zero footgun
  it('THROWS on empty string amountMinor (WHY: BigInt("") => 0n silently, not a throw — guard stops silent-$0 fake balance)', () => {
    expect(() => trialActivity([L('asset', 'DEBIT', ''), L('ar', 'CREDIT', '')]))
      .toThrow(/invalid amountMinor/);
  });

  it('THROWS on decimal amountMinor "1.5" (WHY: unified guard catches malformed values with descriptive error)', () => {
    expect(() => trialActivity([L('asset', 'DEBIT', '1.5'), L('ar', 'CREDIT', '1.5')]))
      .toThrow(/invalid amountMinor/);
  });

  it('THROWS on non-numeric amountMinor "abc" (WHY: unified guard catches malformed values with descriptive error)', () => {
    expect(() => trialActivity([L('asset', 'DEBIT', 'abc'), L('ar', 'CREDIT', 'abc')]))
      .toThrow(/invalid amountMinor/);
  });

  it('accepts valid "0" and normal integer strings', () => {
    const r = trialActivity([L('asset', 'DEBIT', '0'), L('ar', 'CREDIT', '0')]);
    expect(r.totalDebitMinor).toBe(0n);
  });
});
