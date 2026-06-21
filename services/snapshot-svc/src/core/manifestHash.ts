import { createHash } from 'node:crypto';
import { encodeManifest } from './manifestCodec.js';
import type { SnapshotManifestStruct } from '../domain/types.js';

// Domain prefix 第三層：leaf 0x00 / node 0x01 / manifest 0x02。防三種 preimage 互撞。
export const MANIFEST_DOMAIN_PREFIX = 0x02;

export function manifestHash(m: SnapshotManifestStruct): string {
  const body = encodeManifest(m);
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([MANIFEST_DOMAIN_PREFIX]), Buffer.from(body)]))
    .digest('hex');
}
