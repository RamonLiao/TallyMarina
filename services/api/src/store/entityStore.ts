import type { Db } from './db.js';
import { ensurePolicySeed } from './policyStore.js';

export interface EntityRow {
  id: string; displayName: string; chainObjectId: string; capObjectId: string; originalPackageId: string;
}

export function insertEntity(db: Db, e: EntityRow): void {
  db.prepare(
    'INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, ?, ?, ?, ?)',
  ).run(e.id, e.displayName, e.chainObjectId, e.capObjectId, e.originalPackageId);
  // openDb's ensurePolicySeed ran before this entity existed (Task 2 seeding is DB-open-time
  // only) — re-run now so every read-path loader (Task 3: getActivePolicy/getActiveCoaMapping)
  // finds a row for entities created after boot.
  ensurePolicySeed(db);
}

function map(r: Record<string, unknown>): EntityRow {
  return {
    id: r.id as string, displayName: r.display_name as string,
    chainObjectId: r.chain_object_id as string, capObjectId: r.cap_object_id as string,
    originalPackageId: r.original_package_id as string,
  };
}

export function listEntities(db: Db): EntityRow[] {
  return (db.prepare('SELECT * FROM entities ORDER BY id').all() as Record<string, unknown>[]).map(map);
}

export function getEntity(db: Db, id: string): EntityRow | null {
  const r = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
