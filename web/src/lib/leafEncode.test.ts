import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/golden-journal.json';
import { leafHash } from './leafEncode';
import type { JournalDTO } from '../api/types';

describe('leafEncode parity (MERGE GATE — must equal on-chain leaf codec)', () => {
  const rows = golden as unknown as JournalDTO[];

  it('fixture is non-empty and every row has a 64-hex leafHash', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(/^[0-9a-f]{64}$/.test(r.leafHash)).toBe(true);
  });

  it('recomputes each JE leafHash byte-identically to the backend', async () => {
    // WHY: this is the L2 spine — if web and backend diverge by one byte, the
    // exported bundle binds to leaves the recipient cannot reproduce, and the
    // "client-recomputable" claim is false. Reversal entries (reversalOf!=null)
    // and null-origin legs are included on purpose.
    for (const r of rows) {
      expect(await leafHash(r.je)).toBe(r.leafHash.toLowerCase());
    }
  });
});
