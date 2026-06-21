export interface SnapshotMeta {
  entityId: string;
  periodId: string;
  createdAtLogical: number; // 邏輯序（period close marker），非 wall clock
}

export interface MerkleParamsFrozen {
  algo: string;
  leafDomainPrefix: string;
  nodeDomainPrefix: string;
  oddNodePolicy: string;
  orderingPolicy: string;
}

export interface SnapshotManifestStruct {
  manifestVersion: string;
  entityId: string;
  periodId: string;
  merkleRoot: string; // hex (32B)
  leafCount: number;
  leafCodecVersion: string;
  merkleParams: MerkleParamsFrozen;
  policyVersions: string[];
  createdAtLogical: number;
}

export interface AuditSnapshot {
  entityId: string;
  periodId: string;
  seq: number;
  manifest: SnapshotManifestStruct;
  manifestHash: string; // hex
  merkleRoot: string;   // hex
  leafCount: number;
  supersedesSeq: number | null;
}

export interface AnchorPayload {
  manifestHash: string; // hex 32B
  merkleRoot: string;   // hex 32B
  periodId: string;
  supersedesSeq: number; // 0 = 無前版（對齊 Move u64；首版用 0）
}

export type SnapshotErrorCode =
  | 'EMPTY_SNAPSHOT'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'PERIOD_ID_TOO_LONG'
  | 'INVALID_ENCODING'
  | 'INVALID_META'
  | 'SNAPSHOT_EXISTS';

export class SnapshotError extends Error {
  constructor(public readonly code: SnapshotErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SnapshotError';
  }
}
