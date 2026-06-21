import { createHash } from 'node:crypto';
import { encodeJeLeaf, JE_LEAF_CODEC_VERSION } from './leafCodec.js';
import type { JournalEntry } from '../domain/types.js';

export interface MerkleManifest {
  merkleRoot: string;
  leafCount: number;
  algo: 'SHA256';
  leafDomainPrefix: '0x00';
  nodeDomainPrefix: '0x01';
  oddNodePolicy: 'PROMOTE';
  orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1';
  leafCodecVersion: 'JE_LEAF_BCS_V1';
}

function sha256(buf: Uint8Array): Buffer {
  return createHash('sha256').update(buf).digest();
}

function assertNoDuplicateKeys(jes: JournalEntry[]): void {
  const keys = new Set<string>();
  for (const je of jes) {
    if (keys.has(je.idempotencyKey)) throw new Error(`merkle: duplicate idempotencyKey ${je.idempotencyKey}`);
    keys.add(je.idempotencyKey);
  }
}

function sortByIdempotencyKey(jes: JournalEntry[]): JournalEntry[] {
  return [...jes].sort((a, b) =>
    a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0);
}

export function leafHash(je: JournalEntry): string {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(encodeJeLeaf(je))])).toString('hex');
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

// sorted leaf hashes (idempotencyKey asc) -> root hex
function rootFromLeaves(leafHexes: string[]): string {
  let level: Buffer[] = leafHexes.map((h) => Buffer.from(h, 'hex'));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Buffer;
      if (i + 1 < level.length) next.push(nodeHash(left, level[i + 1] as Buffer));
      else next.push(left); // odd node promoted unchanged (RFC 6962)
    }
    level = next;
  }
  return (level[0] as Buffer).toString('hex');
}

export interface InclusionProof {
  // NON-AUTHORITATIVE: generation-time sort position only. verifyInclusion does NOT read or
  // trust leafIndex — membership is proven solely by re-hashing leafBytes and folding `siblings`
  // by their L/R position. Do NOT use leafIndex as an authenticated fact (e.g. for ordering /
  // prefix proofs); under a future SNAPSHOT_BUSINESS_ORDER_V2 the sequence number must live in
  // the leaf preimage, not here. (dual-review tie-breaker: codex / grok / whole-branch)
  leafIndex: number;
  siblings: { hash: string; position: 'L' | 'R' }[];
}

export function inclusionProof(jes: JournalEntry[], idempotencyKey: string): InclusionProof {
  assertNoDuplicateKeys(jes);
  const sorted = sortByIdempotencyKey(jes);
  const sortedKeys = sorted.map((j) => j.idempotencyKey);
  const leafHexes = sorted.map(leafHash);
  const leafIndex = sortedKeys.indexOf(idempotencyKey);
  if (leafIndex < 0) throw new Error(`merkle: idempotencyKey not found ${idempotencyKey}`);

  const siblings: { hash: string; position: 'L' | 'R' }[] = [];
  let level: Buffer[] = leafHexes.map((h) => Buffer.from(h, 'hex'));
  let idx = leafIndex;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const pairIdx = isRight ? idx - 1 : idx + 1;
    if (pairIdx < level.length) {
      siblings.push({ hash: level[pairIdx]!.toString('hex'), position: isRight ? 'L' : 'R' });
    }
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i]!, level[i + 1]!));
      else next.push(level[i]!);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return { leafIndex, siblings };
}

export function verifyInclusion(leafBytes: Uint8Array, proof: InclusionProof, root: string): boolean {
  let acc = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(leafBytes)]));
  for (const sib of proof.siblings) {
    const sibBuf = Buffer.from(sib.hash, 'hex');
    acc = sib.position === 'L' ? nodeHash(sibBuf, acc) : nodeHash(acc, sibBuf);
  }
  return acc.toString('hex') === root;
}

export function buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] } {
  if (jes.length === 0) throw new Error('merkle: empty JE set');
  assertNoDuplicateKeys(jes);
  const sorted = sortByIdempotencyKey(jes);
  const leafHashes = sorted.map(leafHash);
  return {
    manifest: {
      merkleRoot: rootFromLeaves(leafHashes),
      leafCount: sorted.length,
      algo: 'SHA256',
      leafDomainPrefix: '0x00',
      nodeDomainPrefix: '0x01',
      oddNodePolicy: 'PROMOTE',
      orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1',
      leafCodecVersion: JE_LEAF_CODEC_VERSION,
    },
    leafHashes,
  };
}
