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

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function leafHash(je: JournalEntry): string {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(encodeJeLeaf(je))])).toString('hex');
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

// sorted leaf hashes (idempotencyKey asc) -> root hex
function rootFromLeaves(leafHexes: string[]): string {
  let level: Buffer[] = leafHexes.map((h) => Buffer.from(h, 'hex') as Buffer);
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

export function buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] } {
  if (jes.length === 0) throw new Error('merkle: empty JE set');
  const keys = new Set<string>();
  for (const je of jes) {
    if (keys.has(je.idempotencyKey)) throw new Error(`merkle: duplicate idempotencyKey ${je.idempotencyKey}`);
    keys.add(je.idempotencyKey);
  }
  const sorted = [...jes].sort((a, b) =>
    a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0);
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
