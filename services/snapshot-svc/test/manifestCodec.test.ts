import { describe, it, expect } from 'vitest';
import { encodeManifest, MANIFEST_CODEC_VERSION } from '../src/core/manifestCodec.js';
import type { SnapshotManifestStruct } from '../src/domain/types.js';

const m: SnapshotManifestStruct = {
  manifestVersion: MANIFEST_CODEC_VERSION,
  entityId: 'entity-1',
  periodId: '2026-Q2',
  merkleRoot: 'aa'.repeat(32),
  leafCount: 3,
  leafCodecVersion: 'JE_LEAF_BCS_V1',
  merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
  policyVersions: ['ps-1', 'rule-1'],
  createdAtLogical: 42,
};

describe('encodeManifest (SNAPSHOT_MANIFEST_BCS_V1)', () => {
  it('is deterministic — same input twice → identical bytes', () => {
    expect(Buffer.from(encodeManifest(m)).toString('hex')).toBe(Buffer.from(encodeManifest(m)).toString('hex'));
  });
  it('GOLDEN: frozen byte vector (detects serialization drift)', () => {
    const hex = Buffer.from(encodeManifest(m)).toString('hex');
    // FROZEN: 2026-06-21 — do not modify without bumping MANIFEST_CODEC_VERSION + re-freezing
    expect(hex).toBe('18534e415053484f545f4d414e49464553545f4243535f563108656e746974792d3107323032362d5132aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03000000000000000e4a455f4c4541465f4243535f563106534841323536043078303004307830310750524f4d4f5445164944454d504f54454e43595f4b45595f4c45585f5631020470732d310672756c652d312a00000000000000');
  });
  it('field change flips bytes (merkleRoot)', () => {
    const a = Buffer.from(encodeManifest(m)).toString('hex');
    const b = Buffer.from(encodeManifest({ ...m, merkleRoot: 'bb'.repeat(32) })).toString('hex');
    expect(a).not.toBe(b);
  });
  it('rejects merkleRoot != 32 bytes', () => {
    expect(() => encodeManifest({ ...m, merkleRoot: 'aa'.repeat(16) })).toThrow();
  });
});
