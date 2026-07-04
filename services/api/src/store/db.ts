import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { backfillPeriodIds } from './backfillPeriod';

export type Db = Database.Database;

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // SQLite has no ADD COLUMN IF NOT EXISTS; a pre-existing dev DB file predating
  // these columns would otherwise crash at runtime instead of picking them up.
  const MIGRATIONS = [
    "ALTER TABLE exception_disposition ADD COLUMN source TEXT NOT NULL DEFAULT 'HUMAN'",
    'ALTER TABLE exception_disposition ADD COLUMN proposal_id INTEGER',
    "ALTER TABLE exception_disposition_log ADD COLUMN source TEXT NOT NULL DEFAULT 'HUMAN'",
    'ALTER TABLE exception_disposition_log ADD COLUMN proposal_id INTEGER',
    'ALTER TABLE triage_proposal ADD COLUMN recall_context TEXT',
    'ALTER TABLE events ADD COLUMN period_id TEXT',
    'ALTER TABLE journal_entries ADD COLUMN period_id TEXT',
    'ALTER TABLE exception_disposition ADD COLUMN period_id TEXT',
    'ALTER TABLE exception_disposition_log ADD COLUMN period_id TEXT',
  ];
  for (const m of MIGRATIONS) {
    try { db.exec(m); } catch (err) {
      // duplicate column = already migrated; anything else (e.g. a genuine SQL/schema
      // error) must not be swallowed — fail loud instead of silently skipping.
      if (!/duplicate column/i.test((err as Error).message)) throw err;
    }
  }
  backfillPeriodIds(db);
  return db;
}
