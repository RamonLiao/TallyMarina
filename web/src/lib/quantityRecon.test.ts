import { describe, it, expect } from 'vitest';
import { quantityRecon } from './quantityRecon';
import type { JournalLine } from '../api/types';

const QL = (side: 'DEBIT' | 'CREDIT', coin: string | null, qty: string | null): JournalLine =>
  ({ account: 'a', side, amountMinor: '0', origCoinType: coin, origQtyMinor: qty, priceRef: null, fxRef: null, leg: 'X' });

describe('quantityRecon', () => {
  it('nets acquired (DEBIT) minus disposed (CREDIT) per coinType', () => {
    const r = quantityRecon([QL('DEBIT', '0x2::sui::SUI', '100'), QL('CREDIT', '0x2::sui::SUI', '30')]);
    expect(r).toEqual([{ coinType: '0x2::sui::SUI', acquiredMinor: 100n, disposedMinor: 30n, netMinor: 70n }]);
  });
  it('skips legs with null origCoinType/origQty (pure-fiat legs)', () => {
    expect(quantityRecon([QL('DEBIT', null, null)])).toEqual([]);
  });
});
