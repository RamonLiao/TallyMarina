import type { Db } from './db.js';
import {
  type AuditSnapshotRepo, type FreezeInput, type FreezeResult, type AuditSnapshot,
  SnapshotError,
} from '@subledger/snapshot-svc';
import { insertSnapshot, getLatestSnapshot } from './snapshotStore.js';

export interface RestatementProvenance {
  reasonCode: string | null; reason: string | null; affectedAmountEstimate: string | null;
  requestedBy: string | null; approvedBy: string | null;
}

/**
 * DB-backed AuditSnapshotRepo. Converges the freeze writer: buildSnapshot() calls
 * freeze() which INSERTs — no second insertSnapshot in the route. Restatement
 * provenance is app-specific (not part of snapshot-svc's FreezeInput), so it is
 * injected at construction and written only onto restate rows (seq>1).
 */
export class SqliteSnapshotRepo implements AuditSnapshotRepo {
  constructor(private readonly db: Db, private readonly provenance?: RestatementProvenance) {}

  freeze(input: FreezeInput, opts?: { restate?: boolean }): FreezeResult {
    const { manifest, manifestHash } = input;
    const { entityId, periodId, merkleRoot, leafCount } = manifest;
    return this.db.transaction((): FreezeResult => {
      const prev = getLatestSnapshot(this.db, entityId, periodId);
      if (prev && !opts?.restate) {
        throw new SnapshotError('SNAPSHOT_EXISTS',
          `snapshot exists for ${entityId}/${periodId}; pass restate:true to supersede`);
      }
      const seq = prev ? prev.seq + 1 : 1;
      const supersedesSeq = prev ? prev.seq : null;
      const id = `snap-${entityId}-${periodId}-${seq}`;
      const prov = prev ? this.provenance : undefined; // provenance only on restate rows
      insertSnapshot(this.db, {
        id, entityId, periodId,
        manifestJson: JSON.stringify(manifest), manifestHash,
        merkleRoot, leafCount, supersedesSeq, seq, status: 'FROZEN',
        restatementReasonCode: prov?.reasonCode ?? null,
        restatementReason: prov?.reason ?? null,
        affectedAmountEstimate: prov?.affectedAmountEstimate ?? null,
        restatementRequestedBy: prov?.requestedBy ?? null,
        restatementApprovedBy: prov?.approvedBy ?? null,
      });
      const snapshot: AuditSnapshot = {
        entityId, periodId, seq, manifest, manifestHash, merkleRoot, leafCount, supersedesSeq,
      };
      return { snapshot, created: true };
    })();
  }

  get(entityId: string, periodId: string): AuditSnapshot | null {
    const row = getLatestSnapshot(this.db, entityId, periodId);
    if (!row) return null;
    const manifest = JSON.parse(row.manifestJson); // throws on corrupt JSON — fail-loud
    return {
      entityId: row.entityId, periodId: row.periodId, seq: row.seq, manifest,
      manifestHash: row.manifestHash, merkleRoot: row.merkleRoot, leafCount: row.leafCount,
      supersedesSeq: row.supersedesSeq,
    };
  }
}
