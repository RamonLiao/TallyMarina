import { describe, it, expect } from 'vitest';
import { buildMerkle, inclusionProof, verifyInclusion } from '../src/core/merkle.js';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'b'.repeat(64), reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ],
  };
}

describe('merkle inclusion proof', () => {
  const jes = ['1', '2', '3', '4', '5'].map((d) => je(d.repeat(64)));
  const { manifest } = buildMerkle(jes);

  it('every leaf verifies against the root', () => {
    // why: auditor 必須能對任一 JE 獨立驗 inclusion，否則錨定無審計價值
    for (const j of jes) {
      const proof = inclusionProof(jes, j.idempotencyKey);
      expect(verifyInclusion(encodeJeLeaf(j), proof, manifest.merkleRoot)).toBe(true);
    }
  });

  it('tampered leaf bytes fail verification', () => {
    // why: 竄改任一借貸行必須令 proof 失敗
    const target = jes[2];
    const proof = inclusionProof(jes, target.idempotencyKey);
    const tampered = je(target.idempotencyKey);
    tampered.lines[0].amountMinor = '999';
    expect(verifyInclusion(encodeJeLeaf(tampered), proof, manifest.merkleRoot)).toBe(false);
  });

  it('wrong root fails verification', () => {
    const proof = inclusionProof(jes, jes[0].idempotencyKey);
    expect(verifyInclusion(encodeJeLeaf(jes[0]), proof, 'f'.repeat(64))).toBe(false);
  });

  it('throws for absent key', () => {
    expect(() => inclusionProof(jes, '9'.repeat(64))).toThrow();
  });
});
