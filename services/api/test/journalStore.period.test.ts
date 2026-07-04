import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE journal_entries (id TEXT PRIMARY KEY, entity_id TEXT, event_id TEXT,
    je_json TEXT, idempotency_key TEXT, leaf_hash TEXT, period_id TEXT)`);
  return d;
}

describe('JE period inheritance', () => {
  it('stores period_id passed from the source event', () => {
    const d = db();
    insertJournalEntry(d as any, {
      id: 'je1', entityId: 'acme', eventId: 'e1', jeJson: '{}',
      idempotencyKey: 'k1', leafHash: 'h1', periodId: '2026-Q2',
    });
    const rows = listJournal(d as any, 'acme');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periodId).toBe('2026-Q2');
  });
});
