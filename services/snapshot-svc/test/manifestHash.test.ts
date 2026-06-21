import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { manifestHash, MANIFEST_DOMAIN_PREFIX } from '../src/core/manifestHash.js';
import { encodeManifest } from '../src/core/manifestCodec.js';
import type { SnapshotManifestStruct } from '../src/domain/types.js';

const m: SnapshotManifestStruct = {
  manifestVersion: 'SNAPSHOT_MANIFEST_BCS_V1', entityId: 'e', periodId: 'p',
  merkleRoot: 'cc'.repeat(32), leafCount: 1, leafCodecVersion: 'JE_LEAF_BCS_V1',
  merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
  policyVersions: ['a'], createdAtLogical: 0,
};

describe('manifestHash', () => {
  it('prefix is 0x02', () => expect(MANIFEST_DOMAIN_PREFIX).toBe(0x02));
  it('equals sha256(0x02 || BCS) hex', () => {
    const expected = createHash('sha256')
      .update(Buffer.concat([Buffer.from([0x02]), Buffer.from(encodeManifest(m))]))
      .digest('hex');
    expect(manifestHash(m)).toBe(expected);
  });
  it('is 32-byte hex', () => expect(manifestHash(m)).toMatch(/^[0-9a-f]{64}$/));
  it('differs from a leaf-prefixed hash of same bytes (domain separation)', () => {
    const leafLike = createHash('sha256')
      .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(encodeManifest(m))]))
      .digest('hex');
    expect(manifestHash(m)).not.toBe(leafLike);
  });
});
