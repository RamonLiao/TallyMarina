import { describe, it, expect } from 'vitest';
import { netByCoinType } from '../src/reconciliation/movement.js';
import { origMemo } from '../../../web/src/lib/balance.js';

// JE fixtures spanning the edges: multi-coin, null legs, debit/credit netting, large BigInt.
const FIXTURES = [
  [
    { account: '1000', side: 'DEBIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10' },
    { account: '4000', side: 'CREDIT', amountMinor: '250', origCoinType: null, origQtyMinor: null },
  ],
  [
    { account: '1000', side: 'CREDIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7' },
    { account: '6000', side: 'DEBIT', amountMinor: '999999999999999999999', origCoinType: '0xusdc::usdc::USDC', origQtyMinor: '999999999999999999999' },
  ],
];

describe('netByCoinType parity with web origMemo', () => {
  for (const [i, lines] of FIXTURES.entries()) {
    it(`fixture ${i} produces byte-identical net map`, () => {
      const backend = netByCoinType(lines as never);
      const web = origMemo(lines as never);
      // Compare as sorted [coinType, string] tuples — bigint-safe equality.
      const norm = (m: Record<string, bigint>) =>
        Object.entries(m).map(([k, v]) => [k, v.toString()]).sort();
      expect(norm(backend)).toEqual(norm(web));
    });
  }
});
