import { describe, it, expect } from 'vitest';
import { recomputeRoot, resolveProofState } from './proofVerify';
import type { AnchorDTO, InclusionProof } from '../api/types';

// SHA-256 hex helper for building expected fixtures (mirrors node merkle.ts: leaf=0x00||bytes, node=0x01||L||R)
async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const anchor = (over: Partial<AnchorDTO>): AnchorDTO => ({
  id: 'a', snapshotId: 's', seq: 1, link: 'L', digest: 'D', explorerUrl: '#',
  anchoredAt: 't', merkleRoot: null, periodId: '', leafCount: 0, ...over,
});

describe('recomputeRoot', () => {
  it('folds leafHash + one R-sibling exactly like the node-side tree', async () => {
    // two leaves A (our leaf) and B (sibling on the right)
    const leafA = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const leafB = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    const expectedRoot = await sha256hex(concat(Uint8Array.of(0x01), hexToBytes(leafA), hexToBytes(leafB)));

    const root = await recomputeRoot(leafA, [{ hash: leafB, position: 'R' }]);
    expect(root).toBe(expectedRoot);
  });

  it('respects L-position (sibling on the left)', async () => {
    const leafA = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const leafB = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    // leaf A is the RIGHT child → sibling B is on the LEFT
    const expectedRoot = await sha256hex(concat(Uint8Array.of(0x01), hexToBytes(leafB), hexToBytes(leafA)));
    const root = await recomputeRoot(leafA, [{ hash: leafB, position: 'L' }]);
    expect(root).toBe(expectedRoot);
  });
});

describe('hexToBytes validation', () => {
  it('throws on odd-length hex (caught as not-64-chars)', async () => {
    // 'abc' is 3 chars — assertHash32 fires first (not 64 chars)
    await expect(recomputeRoot('abc', [])).rejects.toThrow('32 bytes');
  });

  it('throws on non-hex chars in leafHashHex (caught by hash format validation)', async () => {
    // 'zz'.repeat(32) is 64 chars but non-hex — assertHash32 regex rejects it
    await expect(recomputeRoot('zz'.repeat(32), [])).rejects.toThrow('32 bytes');
  });

  it('throws on malformed sibling hash (non-hex, caught by assertHash32)', async () => {
    const validLeaf = 'aa'.repeat(32);
    await expect(
      recomputeRoot(validLeaf, [{ hash: 'zz'.repeat(32), position: 'R' }])
    ).rejects.toThrow('32 bytes');
  });

  it('valid even-length hex-only strings still work', async () => {
    const leafA = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const leafB = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    // should not throw
    await expect(recomputeRoot(leafA, [{ hash: leafB, position: 'R' }])).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws when leafHash is valid hex but not 64 chars (too short)', async () => {
    await expect(recomputeRoot('aabb', [])).rejects.toThrow('32 bytes');
  });

  it('throws when leafHash is empty string', async () => {
    await expect(recomputeRoot('', [])).rejects.toThrow('32 bytes');
  });

  it('throws when sibling hash is valid hex but not 64 chars', async () => {
    const validLeaf = 'aa'.repeat(32);
    await expect(
      recomputeRoot(validLeaf, [{ hash: 'bb', position: 'L' }])
    ).rejects.toThrow('32 bytes');
  });
});

describe('resolveProofState', () => {
  const proofFor = async (): Promise<{ proof: InclusionProof; leafHash: string; root: string }> => {
    const leafHash = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const sib = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    const root = await recomputeRoot(leafHash, [{ hash: sib, position: 'R' }]);
    return { leafHash, root, proof: { idempotencyKey: 'k', leafIndex: 0, siblings: [{ hash: sib, position: 'R' }], merkleRoot: root } };
  };

  it('not-in-journal when proof is null', async () => {
    const s = await resolveProofState({ leafHash: 'x', proof: null, anchors: [] });
    expect(s.kind).toBe('not-in-journal');
  });

  it('verified-onchain when recomputed root matches an anchor merkleRoot', async () => {
    const { leafHash, root, proof } = await proofFor();
    const s = await resolveProofState({ leafHash, proof, anchors: [anchor({ merkleRoot: root, seq: 7 })] });
    expect(s.kind).toBe('verified-onchain');
    if (s.kind === 'verified-onchain') expect(s.anchor.seq).toBe(7);
  });

  it('verified-pending when proof verifies but no anchor carries that root', async () => {
    const { leafHash, proof } = await proofFor();
    const s = await resolveProofState({ leafHash, proof, anchors: [anchor({ merkleRoot: 'deadbeef' })] });
    expect(s.kind).toBe('verified-pending');
  });

  it('mismatch when the proof does NOT recompute to its claimed root (tamper)', async () => {
    const { leafHash, proof } = await proofFor();
    const tampered: InclusionProof = { ...proof, merkleRoot: 'ff'.repeat(32) };
    const s = await resolveProofState({ leafHash, proof: tampered, anchors: [] });
    expect(s.kind).toBe('mismatch');
  });

  it('verifies regardless of hash case (uppercase proof root matches lowercase anchor root)', async () => {
    const { leafHash, root, proof } = await proofFor();
    // Mixed-case on BOTH sides (different casings) — normalization must verify regardless.
    const mixUp = (h: string) => h.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('');
    const mixDown = (h: string) => h.split('').map((c, i) => (i % 2 ? c.toLowerCase() : c.toUpperCase())).join('');
    const upper: InclusionProof = { ...proof, merkleRoot: mixUp(root) };
    const s = await resolveProofState({ leafHash, proof: upper, anchors: [anchor({ merkleRoot: mixDown(root), seq: 9 })] });
    expect(s.kind).toBe('verified-onchain');
    if (s.kind === 'verified-onchain') expect(s.anchor.seq).toBe(9);
  });

  it('throws when proof.merkleRoot is valid hex but not 64 chars', async () => {
    const { leafHash, proof } = await proofFor();
    const badRoot: InclusionProof = { ...proof, merkleRoot: 'deadbeef' };
    await expect(resolveProofState({ leafHash, proof: badRoot, anchors: [] })).rejects.toThrow('32 bytes');
  });
});
