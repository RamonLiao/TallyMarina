import type { Db } from './db.js';
import { assertSnapshotTransition, type SnapshotStatus } from './stateMachine.js';

export interface SnapshotRow {
  id: string; entityId: string; periodId: string;
  manifestJson: string; manifestHash: string; merkleRoot: string;
  leafCount: number; supersedesSeq: number | null; status: SnapshotStatus;
  seq: number;
  restatementReasonCode: string | null; restatementReason: string | null;
  affectedAmountEstimate: string | null;
  restatementRequestedBy: string | null; restatementApprovedBy: string | null;
}

function rowFrom(r: Record<string, unknown>): SnapshotRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, periodId: r.period_id as string,
    manifestJson: r.manifest_json as string, manifestHash: r.manifest_hash as string,
    merkleRoot: r.merkle_root as string, leafCount: r.leaf_count as number,
    supersedesSeq: (r.supersedes_seq as number | null) ?? null, status: r.status as SnapshotStatus,
    seq: r.seq as number,
    restatementReasonCode: (r.restatement_reason_code as string | null) ?? null,
    restatementReason: (r.restatement_reason as string | null) ?? null,
    affectedAmountEstimate: (r.affected_amount_estimate as string | null) ?? null,
    restatementRequestedBy: (r.restatement_requested_by as string | null) ?? null,
    restatementApprovedBy: (r.restatement_approved_by as string | null) ?? null,
  };
}

export function insertSnapshot(
  db: Db,
  r: Omit<SnapshotRow, 'status' | 'restatementReasonCode' | 'restatementReason'
    | 'affectedAmountEstimate' | 'restatementRequestedBy' | 'restatementApprovedBy'>
    & {
      status?: SnapshotStatus;
      restatementReasonCode?: string | null; restatementReason?: string | null;
      affectedAmountEstimate?: string | null;
      restatementRequestedBy?: string | null; restatementApprovedBy?: string | null;
    },
): void {
  db.prepare(
    `INSERT INTO snapshots
       (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count,
        supersedes_seq, status, seq, restatement_reason_code, restatement_reason,
        affected_amount_estimate, restatement_requested_by, restatement_approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id, r.entityId, r.periodId, r.manifestJson, r.manifestHash, r.merkleRoot, r.leafCount,
    r.supersedesSeq, r.status ?? 'FROZEN', r.seq,
    r.restatementReasonCode ?? null, r.restatementReason ?? null, r.affectedAmountEstimate ?? null,
    r.restatementRequestedBy ?? null, r.restatementApprovedBy ?? null,
  );
}

export function getSnapshot(db: Db, id: string): SnapshotRow | null {
  const r = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? rowFrom(r) : null;
}

export function getLatestSnapshot(db: Db, entityId: string, periodId: string): SnapshotRow | null {
  const r = db.prepare(
    'SELECT * FROM snapshots WHERE entity_id = ? AND period_id = ? ORDER BY seq DESC LIMIT 1',
  ).get(entityId, periodId) as Record<string, unknown> | undefined;
  return r ? rowFrom(r) : null;
}

export function getLatestSnapshotSeq(db: Db, entityId: string, periodId: string): number {
  const r = db.prepare(
    'SELECT MAX(seq) AS m FROM snapshots WHERE entity_id = ? AND period_id = ?',
  ).get(entityId, periodId) as { m: number | null };
  return r.m ?? 0;
}

export function listSnapshotsForPeriod(db: Db, entityId: string, periodId: string): SnapshotRow[] {
  return (db.prepare(
    'SELECT * FROM snapshots WHERE entity_id = ? AND period_id = ? ORDER BY seq ASC',
  ).all(entityId, periodId) as Record<string, unknown>[]).map(rowFrom);
}

export function setSnapshotStatus(db: Db, id: string, to: SnapshotStatus): void {
  const cur = getSnapshot(db, id);
  if (!cur) throw new Error(`SNAPSHOT_NOT_FOUND: ${id}`);
  assertSnapshotTransition(cur.status, to);
  db.prepare('UPDATE snapshots SET status=? WHERE id=?').run(to, id);
}

export function hasAnchoredSnapshot(db: Db, entityId: string): boolean {
  const r = db.prepare("SELECT 1 FROM snapshots WHERE entity_id = ? AND status = 'ANCHORED' LIMIT 1").get(entityId);
  return r !== undefined;
}

export function hasAnchoredSnapshotForPeriod(db: Db, entityId: string, periodId: string): boolean {
  const r = db.prepare("SELECT 1 FROM snapshots WHERE entity_id = ? AND period_id = ? AND status = 'ANCHORED' LIMIT 1").get(entityId, periodId);
  return r !== undefined;
}
