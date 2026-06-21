import { bcs } from '@mysten/bcs';
import type { SnapshotManifestStruct } from '../domain/types.js';

export const MANIFEST_CODEC_VERSION = 'SNAPSHOT_MANIFEST_BCS_V1';

// FROZEN schema — 欄位順序/型別不可改，除非 bump version + 重凍 golden。順序見 spec §10 附錄。
const MerkleParamsBcs = bcs.struct('MerkleParamsBcs', {
  algo: bcs.string(),
  leafDomainPrefix: bcs.string(),
  nodeDomainPrefix: bcs.string(),
  oddNodePolicy: bcs.string(),
  orderingPolicy: bcs.string(),
});

const SnapshotManifestBcs = bcs.struct('SnapshotManifestBcs', {
  manifestVersion: bcs.string(),
  entityId: bcs.string(),
  periodId: bcs.string(),
  merkleRoot: bcs.fixedArray(32, bcs.u8()),
  leafCount: bcs.u64(),
  leafCodecVersion: bcs.string(),
  merkleParams: MerkleParamsBcs,
  policyVersions: bcs.vector(bcs.string()),
  createdAtLogical: bcs.u64(),
});

function isValidUtf8(s: string): boolean {
  return Buffer.from(s, 'utf8').toString('utf8') === s;
}

function assertUtf8(s: string, fieldName: string): void {
  if (!isValidUtf8(s)) {
    throw new Error(`manifestCodec: ${fieldName} is not valid UTF-8`);
  }
}

function hexTo32Bytes(hex: string): number[] {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`manifestCodec: merkleRoot must be 32-byte lowercase hex, got len ${hex.length}`);
  }
  return Array.from(Buffer.from(hex, 'hex'));
}

export function encodeManifest(m: SnapshotManifestStruct): Uint8Array {
  // spec §10 A1: all string fields must be valid UTF-8 at the serialization boundary
  assertUtf8(m.manifestVersion, 'manifestVersion');
  assertUtf8(m.entityId, 'entityId');
  assertUtf8(m.periodId, 'periodId');
  assertUtf8(m.leafCodecVersion, 'leafCodecVersion');
  assertUtf8(m.merkleParams.algo, 'merkleParams.algo');
  assertUtf8(m.merkleParams.leafDomainPrefix, 'merkleParams.leafDomainPrefix');
  assertUtf8(m.merkleParams.nodeDomainPrefix, 'merkleParams.nodeDomainPrefix');
  assertUtf8(m.merkleParams.oddNodePolicy, 'merkleParams.oddNodePolicy');
  assertUtf8(m.merkleParams.orderingPolicy, 'merkleParams.orderingPolicy');
  for (const pv of m.policyVersions) {
    assertUtf8(pv, 'policyVersions[]');
  }

  return SnapshotManifestBcs.serialize({
    manifestVersion: m.manifestVersion,
    entityId: m.entityId,
    periodId: m.periodId,
    merkleRoot: hexTo32Bytes(m.merkleRoot),
    leafCount: m.leafCount,
    leafCodecVersion: m.leafCodecVersion,
    merkleParams: m.merkleParams,
    policyVersions: m.policyVersions,
    createdAtLogical: m.createdAtLogical,
  }).toBytes();
}
