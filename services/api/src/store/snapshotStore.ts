import type { Db } from './db.js';
import { assertSnapshotTransition, type SnapshotStatus } from './stateMachine.js';

export interface SnapshotRow {
  id: string; entityId: string; periodId: string; manifestJson: string;
  manifestHash: string; merkleRoot: string; leafCount: number; supersedesSeq: number | null; status: SnapshotStatus;
}

function map(r: Record<string, unknown>): SnapshotRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, periodId: r.period_id as string,
    manifestJson: r.manifest_json as string, manifestHash: r.manifest_hash as string,
    merkleRoot: r.merkle_root as string, leafCount: r.leaf_count as number,
    supersedesSeq: (r.supersedes_seq as number | null) ?? null, status: r.status as SnapshotStatus,
  };
}

export function insertSnapshot(db: Db, r: Omit<SnapshotRow, 'status'> & { status?: SnapshotStatus }): void {
  db.prepare(
    'INSERT INTO snapshots (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, supersedes_seq, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(r.id, r.entityId, r.periodId, r.manifestJson, r.manifestHash, r.merkleRoot, r.leafCount, r.supersedesSeq, r.status ?? 'FROZEN');
}

export function getSnapshot(db: Db, id: string): SnapshotRow | null {
  const r = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function setSnapshotStatus(db: Db, id: string, to: SnapshotStatus): void {
  const cur = getSnapshot(db, id);
  if (!cur) throw new Error(`SNAPSHOT_NOT_FOUND: ${id}`);
  assertSnapshotTransition(cur.status, to);
  db.prepare('UPDATE snapshots SET status=? WHERE id=?').run(to, id);
}
