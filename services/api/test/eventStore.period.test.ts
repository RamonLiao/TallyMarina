import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { insertEvent, listEvents, deriveEventPeriod } from '../src/store/eventStore';

function freshEventsDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, entity_id TEXT, raw_json TEXT,
    ai_event_type TEXT, ai_purpose TEXT, ai_counterparty TEXT, ai_confidence REAL,
    ai_reasoning TEXT, final_event_type TEXT, final_purpose TEXT, status TEXT, period_id TEXT)`);
  return db;
}

describe('insertEvent period attribution', () => {
  it('stores period_id derived from raw_json.eventTime', () => {
    const db = freshEventsDb();
    insertEvent(db as any, { id: 'e1', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    const rows = listEvents(db as any, 'acme');
    expect(rows[0]!.periodId).toBe('2026-Q2');
  });

  it('throws INVALID_EVENT_TIME on unparseable time', () => {
    const db = freshEventsDb();
    expect(() =>
      insertEvent(db as any, { id: 'bad', entityId: 'acme', rawJson: JSON.stringify({ eventTime: 'nope' }) }),
    ).toThrow(/INVALID_EVENT_TIME/);
  });

  it('deriveEventPeriod extracts period from rawJson', () => {
    expect(deriveEventPeriod(JSON.stringify({ eventTime: '2026-08-01T00:00:00Z' }))).toBe('2026-Q3');
  });
});
