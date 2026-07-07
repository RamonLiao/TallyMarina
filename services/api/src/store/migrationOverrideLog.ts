import type { Db } from './db.js';

export interface MigrationOverrideRow {
  snapshotId: string; oldRoot: string; recomputedRoot: string;
  operator: string; acceptedAt: string; justification: string;
}

export function insertMigrationOverride(db: Db, r: MigrationOverrideRow): void {
  db.prepare(
    `INSERT INTO migration_override_log
       (snapshot_id, old_root, recomputed_root, operator, accepted_at, justification)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(r.snapshotId, r.oldRoot, r.recomputedRoot, r.operator, r.acceptedAt, r.justification);
}

export function listMigrationOverrides(db: Db): MigrationOverrideRow[] {
  return (db.prepare('SELECT * FROM migration_override_log ORDER BY seq ASC').all() as Record<string, unknown>[])
    .map((r) => ({
      snapshotId: r.snapshot_id as string, oldRoot: r.old_root as string,
      recomputedRoot: r.recomputed_root as string, operator: r.operator as string,
      acceptedAt: r.accepted_at as string, justification: r.justification as string,
    }));
}
