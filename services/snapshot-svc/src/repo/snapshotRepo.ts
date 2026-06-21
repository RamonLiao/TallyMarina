import { AuditSnapshot, SnapshotError } from '../domain/types.js';

export interface FreezeResult {
  snapshot: AuditSnapshot;
  created: boolean;
}

export interface AuditSnapshotRepo {
  freeze(snapshot: Omit<AuditSnapshot, 'seq' | 'supersedesSeq'>, opts?: { restate?: boolean }): FreezeResult;
  get(entityId: string, periodId: string): AuditSnapshot | null;
}

function keyOf(entityId: string, periodId: string): string {
  return JSON.stringify([entityId, periodId]);
}

export class InMemorySnapshotRepo implements AuditSnapshotRepo {
  private readonly versions = new Map<string, AuditSnapshot[]>();

  freeze(snapshot: Omit<AuditSnapshot, 'seq' | 'supersedesSeq'>, opts?: { restate?: boolean }): FreezeResult {
    const k = keyOf(snapshot.entityId, snapshot.periodId);
    const chain = this.versions.get(k);
    if (!chain || chain.length === 0) {
      const frozen: AuditSnapshot = { ...snapshot, seq: 0, supersedesSeq: null };
      this.versions.set(k, [frozen]);
      return { snapshot: frozen, created: true };
    }
    if (!opts?.restate) {
      throw new SnapshotError('SNAPSHOT_EXISTS', `snapshot exists for ${snapshot.entityId}/${snapshot.periodId}; pass restate:true to supersede`);
    }
    const prev = chain[chain.length - 1] as AuditSnapshot;
    const frozen: AuditSnapshot = { ...snapshot, seq: prev.seq + 1, supersedesSeq: prev.seq };
    chain.push(frozen);
    return { snapshot: frozen, created: true };
  }

  get(entityId: string, periodId: string): AuditSnapshot | null {
    const chain = this.versions.get(keyOf(entityId, periodId));
    if (!chain || chain.length === 0) return null;
    return chain[chain.length - 1] as AuditSnapshot;
  }
}
