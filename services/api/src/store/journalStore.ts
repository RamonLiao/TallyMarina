// GUARDRAIL: nothing under src/ai/ may import this module. Enforced by test/aiGuardrail.test.ts.
import type { Db } from './db.js';

export interface JournalRow {
  id: string; entityId: string; eventId: string; jeJson: string; idempotencyKey: string; leafHash: string;
}

export function insertJournalEntry(db: Db, r: JournalRow): 'inserted' | 'duplicate' {
  // INSERT OR IGNORE avoids TOCTOU: under concurrent callers the SELECT-then-INSERT
  // pattern can let two writers both pass the SELECT, then the second throws a UNIQUE
  // violation. Using INSERT OR IGNORE means the DB engine serializes at the row level —
  // if the key already exists it silently skips; we detect by checking rows-changed.
  const result = db
    .prepare('INSERT OR IGNORE INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.eventId, r.jeJson, r.idempotencyKey, r.leafHash);
  return result.changes > 0 ? 'inserted' : 'duplicate';
}

export function listJournal(db: Db, entityId: string): JournalRow[] {
  return (db.prepare('SELECT * FROM journal_entries WHERE entity_id = ? ORDER BY idempotency_key').all(entityId) as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string, entityId: r.entity_id as string, eventId: r.event_id as string,
      jeJson: r.je_json as string, idempotencyKey: r.idempotency_key as string, leafHash: r.leaf_hash as string,
    }));
}
