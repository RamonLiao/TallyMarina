import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  ];
  for (const m of MIGRATIONS) {
    try { db.exec(m); } catch { /* duplicate column = already migrated */ }
  }
  return db;
}
