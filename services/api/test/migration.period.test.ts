import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db';

describe('period_id schema migration', () => {
  it('adds period_id to events and journal_entries on a fresh DB', () => {
    const db = openDb(':memory:');
    const eventCols = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
    const jeCols = db.prepare(`PRAGMA table_info(journal_entries)`).all() as { name: string }[];
    expect(eventCols.map((c) => c.name)).toContain('period_id');
    expect(jeCols.map((c) => c.name)).toContain('period_id');
  });

  it('adds period_id to exception_disposition tables', () => {
    const db = openDb(':memory:');
    const cols = db.prepare(`PRAGMA table_info(exception_disposition)`).all() as { name: string }[];
    const logCols = db.prepare(`PRAGMA table_info(exception_disposition_log)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('period_id');
    expect(logCols.map((c) => c.name)).toContain('period_id');
  });

  it('creates the entity+period indexes', () => {
    const db = openDb(':memory:');
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[];
    const names = idx.map((i) => i.name);
    expect(names).toContain('idx_events_entity_period');
    expect(names).toContain('idx_je_entity_period');
  });
});
