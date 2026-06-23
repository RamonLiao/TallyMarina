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
  anchoredAt: 't', merkleRoot: null, ...over,
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
});
