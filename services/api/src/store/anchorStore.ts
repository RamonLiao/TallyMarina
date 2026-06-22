import type { Db } from './db.js';

export interface AnchorRow {
  id: string; entityId: string; snapshotId: string; seq: number; link: string; digest: string; explorerUrl: string; anchoredAt: string;
}

export function insertAnchor(db: Db, r: AnchorRow): void {
  db.prepare('INSERT INTO anchors (id, entity_id, snapshot_id, seq, link, digest, explorer_url, anchored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.snapshotId, r.seq, r.link, r.digest, r.explorerUrl, r.anchoredAt);
}

export function listAnchors(db: Db, entityId: string): AnchorRow[] {
  return (db.prepare('SELECT * FROM anchors WHERE entity_id = ? ORDER BY seq').all(entityId) as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string, entityId: r.entity_id as string, snapshotId: r.snapshot_id as string,
      seq: r.seq as number, link: r.link as string, digest: r.digest as string,
      explorerUrl: r.explorer_url as string, anchoredAt: r.anchored_at as string,
    }));
}
