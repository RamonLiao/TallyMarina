// DATA ZONE (spec §8.4) — NEVER import Mascot here.
// Browser-side inclusion-proof verification (spec §6). We recompute the Merkle
// root from the JE's leafHash + sibling path using WebCrypto SHA-256, mirroring
// the node-side fold in services/rules-engine/src/core/merkle.ts:
//   leaf  = SHA-256(0x00 || leafBytes)   ← already given to us as JournalDTO.leafHash
//   node  = SHA-256(0x01 || left || right)
// We start from leafHash (the leaf digest) and fold siblings. This is genuine
// client recomputation of the on-chain-anchored root — NOT a backend boolean.
import type { AnchorDTO, InclusionProof } from '../api/types';

const LEAF_NODE_PREFIX = 0x01;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/** SHA-256 hashes must be exactly 32 bytes (64 hex chars). */
function assertHash32(hex: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('proof hash must be exactly 32 bytes (64 hex chars)');
}
function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer));
}
async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(Uint8Array.of(LEAF_NODE_PREFIX), left, right));
}

/** Fold leafHash up through the sibling path to the Merkle root (hex). */
export async function recomputeRoot(
  leafHashHex: string,
  siblings: { hash: string; position: 'L' | 'R' }[],
): Promise<string> {
  assertHash32(leafHashHex);
  let acc = hexToBytes(leafHashHex);
  for (const sib of siblings) {
    assertHash32(sib.hash);
    const sibBytes = hexToBytes(sib.hash);
    acc = sib.position === 'L' ? await nodeHash(sibBytes, acc) : await nodeHash(acc, sibBytes);
  }
  return bytesToHex(acc);
}

export type ProofState =
  | { kind: 'verified-onchain'; anchor: AnchorDTO }
  | { kind: 'verified-pending' }
  | { kind: 'not-in-journal' }
  | { kind: 'mismatch'; recomputed: string; claimed: string }
  | { kind: 'error'; message: string };

/**
 * Three honest states (+ mismatch). `proof === null` means the idempotencyKey is
 * not in the live journal (e.g. the JE was reversed) — distinct from pending.
 */
export async function resolveProofState(args: {
  leafHash: string;
  proof: InclusionProof | null;
  anchors: AnchorDTO[];
}): Promise<ProofState> {
  const { leafHash, proof, anchors } = args;
  if (!proof) return { kind: 'not-in-journal' };

  assertHash32(proof.merkleRoot);
  const recomputed = await recomputeRoot(leafHash, proof.siblings);
  if (recomputed !== proof.merkleRoot) {
    return { kind: 'mismatch', recomputed, claimed: proof.merkleRoot };
  }
  const match = anchors.find((a) => a.merkleRoot !== null && a.merkleRoot === proof.merkleRoot);
  return match ? { kind: 'verified-onchain', anchor: match } : { kind: 'verified-pending' };
}
