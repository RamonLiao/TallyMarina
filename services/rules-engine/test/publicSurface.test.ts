import { describe, it, expect } from 'vitest';
import { buildMerkle, evaluate, reverse } from '../src/index.js';
import type { MerkleManifest, RuleOutput, JournalEntry, JeLine } from '../src/index.js';

describe('rules-engine public surface', () => {
  it('re-exports buildMerkle + existing fns', () => {
    expect(typeof buildMerkle).toBe('function');
    expect(typeof evaluate).toBe('function');
    expect(typeof reverse).toBe('function');
  });
  it('buildMerkle returns manifest+leafHashes for one JE', () => {
    const je: JournalEntry = {
      idempotencyKey: 'k1', lineageHash: 'lh', reversalOf: null,
      lines: [
        { account: 'a', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
        { account: 'b', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
      ],
    };
    const { manifest, leafHashes }: { manifest: MerkleManifest; leafHashes: string[] } = buildMerkle([je]);
    expect(manifest.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.leafCount).toBe(1);
    expect(leafHashes).toHaveLength(1);
  });
  // 型別 import 編譯通過即證 RuleOutput/JeLine 已 re-export
  const _t: (o: RuleOutput, l: JeLine) => void = () => {};
  it('type re-exports compile', () => expect(typeof _t).toBe('function'));
});
