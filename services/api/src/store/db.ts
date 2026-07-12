import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { backfillPeriodIds } from './backfillPeriod';
import { ensurePolicySeed } from './policyStore';

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
    'ALTER TABLE snapshots ADD COLUMN seq INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE snapshots ADD COLUMN restatement_reason_code TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_reason TEXT',
    'ALTER TABLE snapshots ADD COLUMN affected_amount_estimate TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_requested_by TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_approved_by TEXT',
    // asset_registry.chain_object_version → metadata_cap_state (D16 revision: CoinMetadata
    // carries no object version; MetadataCapState is the real re-verification anchor). Repo
    // migration philosophy: schema.sql defines the column for fresh DBs; a pre-existing dev DB
    // picks it up via this duplicate-column-tolerant ALTER ADD, and columns are NEVER dropped
    // (see was_anchored_at_reopen) — the old chain_object_version lingers as an inert, never
    // read/written orphan on such DBs. ASYMMETRY (do not paper over): SQLite cannot attach a
    // CHECK via ALTER ADD COLUMN, so fresh DBs enforce the IN(...) allow-list on this column
    // while pre-existing dev DBs get the column WITHOUT the CHECK — same situation as snapshots.seq.
    'ALTER TABLE asset_registry ADD COLUMN metadata_cap_state TEXT',
    'ALTER TABLE journal_entries ADD COLUMN policy_set_version TEXT',
    'ALTER TABLE journal_entries ADD COLUMN rule_version TEXT',
    'ALTER TABLE lot_valuation ADD COLUMN pnl_delta_minor TEXT',
  ];
  for (const m of MIGRATIONS) {
    try { db.exec(m); } catch (err) {
      // duplicate column = already migrated; anything else (e.g. a genuine SQL/schema
      // error) must not be swallowed — fail loud instead of silently skipping.
      if (!/duplicate column/i.test((err as Error).message)) throw err;
    }
  }
  ensureSnapshotSeqUnique(db);
  backfillPeriodIds(db);
  ensurePolicySeed(db);
  return db;
}

// schema.sql carries `UNIQUE (entity_id, period_id, seq)` for fresh DBs, but SQLite
// cannot ALTER a table-level constraint onto DBs created before the seq column existed.
// A unique index enforces the restatement-chain invariant identically; CREATE UNIQUE
// INDEX (unlike ADD CONSTRAINT) works on an existing table. Runs after MIGRATIONS so the
// seq column is guaranteed present. See idx_triage_open for the same migrate-via-index pattern.
function ensureSnapshotSeqUnique(db: Db): void {
  // Pre-flight: if a legacy DB already holds colliding rows, CREATE UNIQUE INDEX would
  // fail with an opaque "UNIQUE constraint failed" and no clue which rows collide.
  // Surface them explicitly (fail loud, but actionable) before attempting the index.
  const dupes = db.prepare(
    `SELECT entity_id, period_id, seq, COUNT(*) AS n
       FROM snapshots
      GROUP BY entity_id, period_id, seq
     HAVING n > 1`,
  ).all() as Array<{ entity_id: string; period_id: string; seq: number; n: number }>;
  if (dupes.length > 0) {
    const detail = dupes
      .map((d) => `(entity=${d.entity_id}, period=${d.period_id}, seq=${d.seq}) x${d.n}`)
      .join('; ');
    throw new Error(
      `snapshots has duplicate (entity_id, period_id, seq) rows; cannot enforce the ` +
        `restatement-chain unique index. Resolve these collisions manually before ` +
        `restarting: ${detail}`,
    );
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_entity_period_seq ' +
      'ON snapshots(entity_id, period_id, seq)',
  );
}
