import { AuditSnapshot, SnapshotError, SnapshotManifestStruct } from '../domain/types.js';

export interface FreezeResult {
  snapshot: AuditSnapshot;
  created: boolean;
}

/**
 * The only caller-supplied facts a freeze needs. entityId/periodId/merkleRoot/leafCount
 * are NOT accepted separately — they are derived from `manifest` so they can never drift
 * from it (the redundant-field inconsistency class is unrepresentable at the boundary
 * rather than guarded at runtime). manifestHash is the one value the repo can't recompute
 * without coupling to the codec layer, so it stays a trusted input.
 */
export interface FreezeInput {
  manifest: SnapshotManifestStruct;
  manifestHash: string;
}

export interface AuditSnapshotRepo {
  freeze(input: FreezeInput, opts?: { restate?: boolean }): FreezeResult;
  get(entityId: string, periodId: string): AuditSnapshot | null;
}

function keyOf(entityId: string, periodId: string): string {
  return JSON.stringify([entityId, periodId]);
}

export class InMemorySnapshotRepo implements AuditSnapshotRepo {
  private readonly versions = new Map<string, AuditSnapshot[]>();

  freeze(input: FreezeInput, opts?: { restate?: boolean }): FreezeResult {
    const { manifest, manifestHash } = input;
    // Top-level mirror fields are derived from the manifest, never taken from the caller,
    // so a stored snapshot is internally consistent by construction.
    const derived: Omit<AuditSnapshot, 'seq' | 'supersedesSeq'> = {
      entityId: manifest.entityId,
      periodId: manifest.periodId,
      manifest,
      manifestHash,
      merkleRoot: manifest.merkleRoot,
      leafCount: manifest.leafCount,
    };
    const k = keyOf(manifest.entityId, manifest.periodId);
    const chain = this.versions.get(k);
    if (!chain || chain.length === 0) {
      // seq starts at 1; 0 is permanently reserved as the "no prior version" sentinel in supersedesSeq
      const frozen: AuditSnapshot = structuredClone({ ...derived, seq: 1, supersedesSeq: null });
      this.versions.set(k, [frozen]);
      return { snapshot: structuredClone(frozen), created: true };
    }
    if (!opts?.restate) {
      throw new SnapshotError('SNAPSHOT_EXISTS', `snapshot exists for ${manifest.entityId}/${manifest.periodId}; pass restate:true to supersede`);
    }
    const prev = chain[chain.length - 1] as AuditSnapshot;
    const frozen: AuditSnapshot = structuredClone({ ...derived, seq: prev.seq + 1, supersedesSeq: prev.seq });
    chain.push(frozen);
    return { snapshot: structuredClone(frozen), created: true };
  }

  get(entityId: string, periodId: string): AuditSnapshot | null {
    const chain = this.versions.get(keyOf(entityId, periodId));
    if (!chain || chain.length === 0) return null;
    return structuredClone(chain[chain.length - 1] as AuditSnapshot);
  }
}
