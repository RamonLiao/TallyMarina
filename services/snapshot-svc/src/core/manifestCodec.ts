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

function hexTo32Bytes(hex: string): number[] {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`manifestCodec: merkleRoot must be 32-byte lowercase hex, got len ${hex.length}`);
  }
  return Array.from(Buffer.from(hex, 'hex'));
}

export function encodeManifest(m: SnapshotManifestStruct): Uint8Array {
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
