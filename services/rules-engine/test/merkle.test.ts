import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildMerkle, leafHash } from '../src/core/merkle.js';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key,
    lineageHash: 'b'.repeat(64),
    reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ],
  };
}
function h(prefix: number, ...chunks: Buffer[]): string {
  return createHash('sha256').update(Buffer.concat([Buffer.from([prefix]), ...chunks])).digest('hex');
}

describe('merkle tree', () => {
  it('leafHash applies 0x00 domain prefix over BCS bytes', () => {
    // why: domain separation 防 second-preimage（把內部 node 當 leaf 偽造）
    const j = je('a'.repeat(64));
    const expected = h(0x00, Buffer.from(encodeJeLeaf(j)));
    expect(leafHash(j)).toBe(expected);
  });

  it('single leaf: root == that leaf hash', () => {
    const j = je('a'.repeat(64));
    const { manifest } = buildMerkle([j]);
    expect(manifest.merkleRoot).toBe(leafHash(j));
    expect(manifest.leafCount).toBe(1);
  });

  it('two leaves: root == node(0x01, sorted left, right)', () => {
    // why: 排序固定，root 必須與手算一致才可被 auditor 重建
    const j1 = je('1'.repeat(64));
    const j2 = je('2'.repeat(64));
    const l1 = Buffer.from(leafHash(j1), 'hex');
    const l2 = Buffer.from(leafHash(j2), 'hex');
    const expected = h(0x01, l1, l2);
    const { manifest } = buildMerkle([j2, j1]); // input order reversed on purpose
    expect(manifest.merkleRoot).toBe(expected);
  });

  it('three leaves: odd node is promoted, not duplicated', () => {
    // why: 複製尾葉會觸發 CVE-2012-2459 duplicate-leaf forgery
    const j1 = je('1'.repeat(64));
    const j2 = je('2'.repeat(64));
    const j3 = je('3'.repeat(64));
    const l1 = Buffer.from(leafHash(j1), 'hex');
    const l2 = Buffer.from(leafHash(j2), 'hex');
    const l3 = Buffer.from(leafHash(j3), 'hex');
    const n12 = Buffer.from(h(0x01, l1, l2), 'hex');
    const expected = h(0x01, n12, l3); // l3 promoted, paired with n12
    const { manifest } = buildMerkle([j1, j2, j3]);
    expect(manifest.merkleRoot).toBe(expected);
  });

  it('manifest carries frozen policy fields', () => {
    const { manifest } = buildMerkle([je('a'.repeat(64))]);
    expect(manifest).toMatchObject({
      algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01',
      oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1', leafCodecVersion: 'JE_LEAF_BCS_V1',
    });
  });

  it('throws on empty set', () => {
    // why: 空 snapshot 無意義，fail-loud 而非回傳偽 root
    expect(() => buildMerkle([])).toThrow();
  });

  it('throws on duplicate idempotencyKey', () => {
    // why: 同 snapshot 重複 JE 是 invariant 違反，須上游 dedup
    expect(() => buildMerkle([je('a'.repeat(64)), je('a'.repeat(64))])).toThrow();
  });
});
