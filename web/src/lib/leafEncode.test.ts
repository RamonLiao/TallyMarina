import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/golden-journal.json';
import { leafHash } from './leafEncode';
import type { JournalDTO, JournalEntryBody } from '../api/types';

describe('leafEncode parity (MERGE GATE — must equal on-chain leaf codec)', () => {
  const rows = golden as unknown as JournalDTO[];

  it('fixture is non-empty and every row has a 64-hex leafHash', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(/^[0-9a-f]{64}$/.test(r.leafHash)).toBe(true);
  });

  it('recomputes each JE leafHash byte-identically to the backend', async () => {
    // WHY: this is the L2 spine — if web and backend diverge by one byte, the
    // exported bundle binds to leaves the recipient cannot reproduce, and the
    // "client-recomputable" claim is false.
    // NOTE: the fixture JEs all have reversalOf=null. The reversalOf!=null
    // (BCS option Some) branch is covered by the deterministic test below.
    for (const r of rows) {
      expect(await leafHash(r.je)).toBe(r.leafHash.toLowerCase());
    }
  });

  it('reversalOf is serialized into the leaf preimage (Some vs None produce different hashes)', async () => {
    // WHY: reversalOf maps to BCS Option<vector<u8>>. If the encoder ever
    // silently drops this field, Some and None would produce identical bytes
    // and this test would fail — catching the "field quietly omitted" failure
    // mode that the parity fixture (all reversalOf=null) cannot catch.
    const base: JournalEntryBody = {
      idempotencyKey: 'idem-reversal-test',
      lineageHash: 'a'.repeat(64),
      reversalOf: null,
      lines: [
        {
          account: 'cash',
          side: 'DEBIT',
          amountMinor: '10000',
          origCoinType: null,
          origQtyMinor: null,
          priceRef: null,
          fxRef: null,
          leg: 'leg-1',
        },
      ],
    };
    const withReversal: JournalEntryBody = { ...base, reversalOf: 'rev-key-1' };

    const hashNull = await leafHash(base);
    const hashSome = await leafHash(withReversal);
    expect(hashNull).not.toBe(hashSome);
  });
});
