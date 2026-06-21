import { describe, it, expect } from 'vitest';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import { buildMerkle, leafHash } from '../src/core/merkle.js';
import type { JournalEntry } from '../src/domain/types.js';

const jes: JournalEntry[] = [
  { idempotencyKey: '1'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10', priceRef: 'P1', fxRef: 'F1', leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '250', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ] },
  { idempotencyKey: '2'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: '1'.repeat(64),
    lines: [
      { account: '4000', side: 'DEBIT', amountMinor: '250', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '1000', side: 'CREDIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10', priceRef: 'P1', fxRef: 'F1', leg: 'MAIN' },
    ] },
  { idempotencyKey: '3'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: null,
    lines: [
      { account: '6000', side: 'DEBIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7', priceRef: 'P2', fxRef: null, leg: 'GAS' },
      { account: '1000', side: 'CREDIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7', priceRef: 'P2', fxRef: null, leg: 'GAS' },
    ] },
];

describe('golden vectors (cross-language alignment baseline)', () => {
  it('leaf bytes + leaf hash are frozen', () => {
    // why: 這些值是外部 auditor(Python/Go/Rust) 重建的對齊錨點，漂移=破壞承諾
    expect(Buffer.from(encodeJeLeaf(jes[0]!)).toString('hex')).toBe(
      '4031313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131000204313030300003323530010d3078323a3a7375693a3a535549010231300102503101024631044d41494e0434303030010332353000000000044d41494e'
    );
    expect(leafHash(jes[0]!)).toBe('f916c77e8b200b7ab060bf0a0bf5a2c9e2d34f36940ec4c809909473d9dec2c6');
    expect(leafHash(jes[1]!)).toBe('6807bb4eb29f367c5f50ec25f3d4f4d9f05880af9e57501d166582be63b4f281');
    expect(leafHash(jes[2]!)).toBe('bc9a0139e1d50cf30b943b1d27a2cf75dba9d22b55b24f618cf6e5485d5cb649');
  });
  it('root is frozen', () => {
    expect(buildMerkle(jes).manifest.merkleRoot).toBe('a79a7f0a941714960aa3efd16f3a1bbadbd2f8e040362e805e3f14e97aff9072');
  });
});

describe('monkey: root stability + lineage isolation', () => {
  it('random permutations of the same JE set yield the same root', () => {
    // why: leaf 排序由 idempotencyKey 決定，輸入順序不得影響 root
    const base = buildMerkle(jes).manifest.merkleRoot;
    const perms = [[2, 0, 1], [1, 2, 0], [2, 1, 0]];
    for (const p of perms) {
      expect(buildMerkle(p.map((i) => jes[i]!)).manifest.merkleRoot).toBe(base);
    }
  });
  it('varying lineageHash does not change the root', () => {
    // why: 再次確認 sidecar 不污染 merkle root（跨整棵樹層級）
    const base = buildMerkle(jes).manifest.merkleRoot;
    const mutated = jes.map((j) => ({ ...j, lineageHash: 'e'.repeat(64) }));
    expect(buildMerkle(mutated).manifest.merkleRoot).toBe(base);
  });
});
