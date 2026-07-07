import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { runP1Gate } from '../src/store/backfillPeriod.js';
import { listMigrationOverrides } from '../src/store/migrationOverrideLog.js';
import { seedAnchoredSnapshot, seedAnchoredSnapshotEmptyPeriod } from './helpers/p1.js';

describe('P1 gate precision + escape-hatch', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { delete process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE; });

  it('passes when recomputed period root equals stored root for a genuinely multi-period entity (old false positive gone)', () => {
    seedAnchoredSnapshot(db, { matchesCurrentBooks: true });
    expect(() => runP1Gate(db)).not.toThrow();
  });

  it('aborts with both roots when recomputed root differs', () => {
    const { storedRoot } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    try {
      runP1Gate(db);
      throw new Error('expected runP1Gate to throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
      expect((err as Error).message).toContain(storedRoot);
    }
  });

  it('escape-hatch: allow-listed snapshot id passes AND writes migration_override_log', () => {
    const { snapshotId, storedRoot } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = snapshotId;
    expect(() => runP1Gate(db)).not.toThrow();
    const log = listMigrationOverrides(db);
    expect(log).toHaveLength(1);
    expect(log[0]!.snapshotId).toBe(snapshotId);
    expect(log[0]!.oldRoot).toBe(storedRoot);
    expect(log[0]!.recomputedRoot).not.toBe(storedRoot);
  });

  it('escape-hatch does not cover a different snapshot id → still aborts', () => {
    const { snapshotId } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = `${snapshotId}-other`;
    expect(() => runP1Gate(db)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
  });

  it('escape-hatch env with blanks/whitespace/nonexistent ids does not accept a real violation', () => {
    seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = 'nonexistent, , ';
    expect(() => runP1Gate(db)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
    expect(listMigrationOverrides(db)).toHaveLength(0);
  });

  it('an anchored snapshot whose period has zero current JEs is skipped (no throw, no abort) — absence is not evidence of mismatch', () => {
    seedAnchoredSnapshotEmptyPeriod(db);
    expect(() => runP1Gate(db)).not.toThrow();
    expect(listMigrationOverrides(db)).toHaveLength(0);
  });
});
