// GUARDRAIL: nothing under src/ai/ may import this module. Enforced by test/aiGuardrail.test.ts.
import type { Db } from './db.js';

export interface JournalRow {
  id: string; entityId: string; eventId: string; jeJson: string; idempotencyKey: string; leafHash: string; periodId?: string | null;
  policySetVersion?: string | null; ruleVersion?: string | null;
}

export function insertJournalEntry(db: Db, r: JournalRow): 'inserted' | 'duplicate' {
  // INSERT OR IGNORE avoids TOCTOU: under concurrent callers the SELECT-then-INSERT
  // pattern can let two writers both pass the SELECT, then the second throws a UNIQUE
  // violation. Using INSERT OR IGNORE means the DB engine serializes at the row level —
  // if the key already exists it silently skips; we detect by checking rows-changed.
  const result = db
    .prepare('INSERT OR IGNORE INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id, policy_set_version, rule_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.eventId, r.jeJson, r.idempotencyKey, r.leafHash, r.periodId, r.policySetVersion ?? null, r.ruleVersion ?? null);
  if (result.changes > 0) return 'inserted';
  // No row inserted → idempotency_key already exists. Mirrors insertLotMovement's fail-loud
  // pattern (commit aa17bf2): a true replay carries an IDENTICAL payload (entity_id, event_id,
  // je_json) → return 'duplicate' (no-op). A DIFFERENT payload under the same key means two
  // distinct events collided on the engine JE key (which excludes eventId) — e.g. two OPENING_LOT
  // ingests sharing (entityId, bookId, rawPayloadHash, txDigest, eventIndex) but different
  // eventId/openingCostMinor. Silently swallowing that lets a forged event ride in under the
  // first event's identity while its lot_movement still posts with attacker-chosen basis
  // (phantom-lot forgery) — fail loud, never silent-drop.
  const prev = db.prepare(
    'SELECT entity_id, event_id, je_json FROM journal_entries WHERE idempotency_key = ?',
  ).get(r.idempotencyKey) as { entity_id: string; event_id: string; je_json: string } | undefined;
  if (!prev) {
    throw new Error(
      `insertJournalEntry: row id=${r.id} idempotency_key=${r.idempotencyKey} was not inserted and no `
      + `existing row matches this idempotency_key — a non-key constraint (e.g. duplicate id) silently `
      + `dropped the insert — ledger corruption`,
    );
  }
  if (prev.entity_id !== r.entityId || prev.event_id !== r.eventId || prev.je_json !== r.jeJson) {
    throw new Error(
      `insertJournalEntry: idempotency_key ${r.idempotencyKey} already persisted with a DIFFERENT payload `
      + `(existing entity=${prev.entity_id} ev=${prev.event_id} je=${prev.je_json}; `
      + `attempted entity=${r.entityId} ev=${r.eventId} je=${r.jeJson}) — ledger corruption`,
    );
  }
  return 'duplicate';
}

export function listJournal(db: Db, entityId: string, periodId?: string): JournalRow[] {
  const rows = periodId
    ? (db.prepare('SELECT * FROM journal_entries WHERE entity_id = ? AND period_id = ? ORDER BY idempotency_key').all(entityId, periodId) as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM journal_entries WHERE entity_id = ? ORDER BY idempotency_key').all(entityId) as Record<string, unknown>[]);
  return rows.map((r) => ({
    id: r.id as string, entityId: r.entity_id as string, eventId: r.event_id as string,
    jeJson: r.je_json as string, idempotencyKey: r.idempotency_key as string, leafHash: r.leaf_hash as string, periodId: (r.period_id as string) || null,
    policySetVersion: (r.policy_set_version as string) || null, ruleVersion: (r.rule_version as string) || null,
  }));
}
