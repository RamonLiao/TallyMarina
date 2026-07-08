import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';

// WHY this suite exists:
// The restatement chain records supersede links via `snapshots.seq`, monotonically
// increasing per (entity_id, period_id). A UNIQUE (entity_id, period_id, seq) is the
// invariant that keeps that chain single-headed — two rows sharing a seq would mean two
// competing supersede heads for the same period, silently forking the audit chain.
// Fresh DBs get this as a table-level constraint from schema.sql. But `seq` was added by
// ALTER on legacy DBs, and SQLite cannot ALTER a table-level constraint in. openDb() must
// therefore migrate the invariant in via CREATE UNIQUE INDEX. These tests prove the
// migrated index actually enforces uniqueness and that colliding legacy data fails loud.

const E = 'ent-1';
const P = '2026-Q2';

// Columns mirror schema.sql's snapshots table, minus the table-level UNIQUE and FK —
// this is exactly the shape a DB created before the constraint/seq migration would carry.
const LEGACY_CREATE = `
  CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    period_id TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    leaf_count INTEGER NOT NULL,
    supersedes_seq INTEGER,
    status TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 1
  )`;

function insertLegacyRow(db: Database.Database, seq: number, root: string) {
  db.prepare(
    `INSERT INTO snapshots
       (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, status, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`snap-${root}`, E, P, '{}', `mh-${root}`, root, 3, 'FINAL', seq);
}

const tmpDirs: string[] = [];
function legacyDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'snapseq-'));
  tmpDirs.push(dir);
  return join(dir, 'legacy.db');
}
function indexExists(db: Database.Database): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
    .get('idx_snapshots_entity_period_seq');
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('snapshots seq unique-index migration', () => {
  it('fresh openDb DB carries the index and rejects a duplicate seq', () => {
    // Reachable real behavior: a fresh DB must already enforce the invariant, and it must
    // do so via the named migrate-by-index (so migrated + fresh DBs are provably symmetric).
    const db = openDb(':memory:');
    expect(indexExists(db)).toBe(true);
    db.exec(
      "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)" +
        " VALUES ('ent-1','X','0x1','0x2','0x3')",
    );
    const ins = (root: string) =>
      db
        .prepare(
          `INSERT INTO snapshots
             (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, status, seq)
           VALUES (?, 'ent-1', '2026-Q2', '{}', ?, ?, 3, 'FINAL', 1)`,
        )
        .run(`snap-${root}`, `mh-${root}`, root);
    ins('aa');
    // Non-vacuous: the second seq=1 for the same (entity,period) must be blocked.
    expect(() => ins('bb')).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  it('adds the index to a legacy (no-constraint) table and then blocks duplicate seq', () => {
    const path = legacyDbPath();
    const setup = new Database(path);
    setup.exec(LEGACY_CREATE);
    insertLegacyRow(setup, 1, 'aa'); // legacy table happily holds one seq=1 row
    expect(indexExists(setup)).toBe(false); // proves the starting table lacked the index
    setup.close();

    // openDb runs the migration path against the pre-existing legacy table.
    const db = openDb(path);
    expect(indexExists(db)).toBe(true);
    // Non-vacuous: a second seq=1 for the same (entity,period) is now rejected by the
    // freshly-created index on a table that previously allowed it.
    expect(() => insertLegacyRow(db, 1, 'cc')).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  it('fails loud with an actionable message when legacy data already has colliding seq', () => {
    const path = legacyDbPath();
    const setup = new Database(path);
    setup.exec(LEGACY_CREATE);
    insertLegacyRow(setup, 1, 'aa');
    insertLegacyRow(setup, 1, 'bb'); // two supersede heads for the same (E,P,seq) — a forked chain
    setup.close();

    // Pre-flight must surface the collision, not let CREATE UNIQUE INDEX throw an opaque error.
    let err: Error | undefined;
    try {
      openDb(path);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/duplicate/i);
    // Message names the exact colliding tuple so an operator can locate the rows.
    expect(err!.message).toContain(`entity=${E}`);
    expect(err!.message).toContain(`period=${P}`);
    expect(err!.message).toContain('seq=1');
  });

  it('is idempotent: reopening a migrated DB does not throw and keeps a single index', () => {
    const path = legacyDbPath();
    const setup = new Database(path);
    setup.exec(LEGACY_CREATE);
    insertLegacyRow(setup, 1, 'aa');
    setup.close();

    openDb(path).close(); // first migration creates the index
    let db!: Database.Database;
    expect(() => { db = openDb(path); }).not.toThrow(); // IF NOT EXISTS → no-op second time
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name=?")
      .get('idx_snapshots_entity_period_seq') as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });
});
