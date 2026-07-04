import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db';
import { insertEvent, listEventsByPeriod } from '../src/store/eventStore';
import { listJournal } from '../src/store/journalStore';

function seedEntity(db: ReturnType<typeof openDb>) {
  db.prepare(
    "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme','ACME','0x1','0x2','0x3')",
  ).run();
}

describe('period-scoped queries (C2 Task 7)', () => {
  it('listEventsByPeriod returns ONLY the requested period, not all history', () => {
    const db = openDb(':memory:');
    seedEntity(db);
    insertEvent(db, { id: 'q1a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(db, { id: 'q2a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });

    const q1 = listEventsByPeriod(db, 'acme', '2026-Q1');
    // Fails under the old all-history behavior (listEvents), which would return both.
    expect(q1.map((e) => e.id)).toEqual(['q1a']);
  });

  it('listJournal filters by periodId when provided', () => {
    const db = openDb(':memory:');
    seedEntity(db);
    insertEvent(db, { id: 'q1b', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(db, { id: 'q2b', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    db.prepare(
      'INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('je1', 'acme', 'q1b', '{}', 'idem-1', 'hash1', '2026-Q1');
    db.prepare(
      'INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('je2', 'acme', 'q2b', '{}', 'idem-2', 'hash2', '2026-Q2');

    const scoped = listJournal(db, 'acme', '2026-Q1');
    expect(scoped.map((j) => j.id)).toEqual(['je1']);

    const all = listJournal(db, 'acme');
    expect(all.map((j) => j.id).sort()).toEqual(['je1', 'je2']);
  });
});
