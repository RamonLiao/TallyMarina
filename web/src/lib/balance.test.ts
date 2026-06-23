import { describe, it, expect } from 'vitest';
import { sumFunctional } from './balance';
import type { JournalLine } from '../api/types';

const line = (side: 'DEBIT' | 'CREDIT', amt: string): JournalLine => ({
  account: 'a', side, amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x',
});

describe('sumFunctional', () => {
  it('balances when debit equals credit (BigInt, no float)', () => {
    const r = sumFunctional([line('DEBIT', '31240'), line('CREDIT', '31240')]);
    expect(r.balanced).toBe(true);
    expect(r.delta).toBe(0n);
  });
  it('flags an out-of-balance entry with a nonzero delta', () => {
    const r = sumFunctional([line('DEBIT', '100'), line('CREDIT', '90')]);
    expect(r.balanced).toBe(false);
    expect(r.delta).toBe(10n);
  });
  it('does not lose precision on large minor units', () => {
    const big = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
    const r = sumFunctional([line('DEBIT', big), line('CREDIT', big)]);
    expect(r.balanced).toBe(true);
  });
});
