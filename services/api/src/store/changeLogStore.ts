// Spec §3.4 / D19: append-only change log. This module offers INSERT and SELECT only —
// no update/delete path exists anywhere in code (SQLite can't hard-forbid; P1 may add triggers).
import type { Db } from './db.js';

export interface ChangeRow {
  seq: number; entityId: string; actor: string; at: string;
  objectType: string; objectRef: string; before: string | null; after: string; reason: string;
}

export function appendChange(db: Db, c: Omit<ChangeRow, 'seq' | 'at'>): void {
  db.prepare(
    'INSERT INTO change_log (entity_id, actor, at, object_type, object_ref, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(c.entityId, c.actor, new Date().toISOString(), c.objectType, c.objectRef, c.before, c.after, c.reason);
}

export function listChanges(db: Db, entityId: string): ChangeRow[] {
  return (db.prepare(
    'SELECT seq, entity_id AS entityId, actor, at, object_type AS objectType, object_ref AS objectRef, before, after, reason FROM change_log WHERE entity_id = ? ORDER BY seq DESC',
  ).all(entityId)) as ChangeRow[];
}
