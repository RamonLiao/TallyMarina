import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/store/db.js';
import { buildMerkle, type JournalEntry } from '../../src/deps/rulesEngine.js';

function makeJe(key: string): JournalEntry {
  return {
    idempotencyKey: key,
    lineageHash: `lh-${key}`,
    reversalOf: null,
    lines: [
      {
        account: 'Cash', side: 'DEBIT', amountMinor: '100',
        origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'main',
      },
      {
        account: 'Revenue', side: 'CREDIT', amountMinor: '100',
        origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'main',
      },
    ],
  };
}

function insertEntity(db: Db, entityId: string): void {
  db.prepare(
    `INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
     VALUES (?, 'Test Entity', 'chain-obj', 'cap-obj', 'pkg')`,
  ).run(entityId);
}

function insertEventWithJe(db: Db, entityId: string, eventId: string, jeId: string, je: JournalEntry, periodId: string): void {
  db.prepare(
    `INSERT INTO events (id, entity_id, raw_json, status, period_id) VALUES (?, ?, '{}', 'INGESTED', ?)`,
  ).run(eventId, entityId, periodId);
  db.prepare(
    `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
     VALUES (?, ?, ?, ?, ?, 'leaf-hash', ?)`,
  ).run(jeId, entityId, eventId, JSON.stringify(je), je.idempotencyKey, periodId);
}

function insertSnapshot(db: Db, snapshotId: string, entityId: string, periodId: string, merkleRoot: string): void {
  db.prepare(
    `INSERT INTO snapshots (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, status)
     VALUES (?, ?, ?, '{}', 'manifest-hash', ?, 1, 'ANCHORED')`,
  ).run(snapshotId, entityId, periodId, merkleRoot);
}

/**
 * Seeds a genuinely MULTI-PERIOD entity: period A (anchored by the returned
 * snapshot) plus period B (unrelated, unanchored). This proves the P1 gate
 * recomputes ONLY the anchored snapshot's own period — an entity-wide rehash
 * would either false-abort (old bug) or accidentally "pass" for the wrong
 * reason. Period A's JE is the sole input to the recompute.
 */
export function seedAnchoredSnapshot(
  db: Db,
  opts: { matchesCurrentBooks: boolean },
): { snapshotId: string; storedRoot: string } {
  const entityId = `ent-${randomUUID()}`;
  insertEntity(db, entityId);

  const periodA = '2026-Q1';
  const periodB = '2026-Q2';

  const jeA = makeJe(`${entityId}-a1`);
  insertEventWithJe(db, entityId, `${entityId}-ea1`, `${entityId}-ja1`, jeA, periodA);

  // Second period, deliberately NOT covered by the snapshot — proves scoping.
  insertEventWithJe(db, entityId, `${entityId}-eb1`, `${entityId}-jb1`, makeJe(`${entityId}-b1`), periodB);

  const recomputedA = buildMerkle([jeA]).manifest.merkleRoot;
  const storedRoot = opts.matchesCurrentBooks ? recomputedA : 'f'.repeat(64);

  const snapshotId = `${entityId}-snap1`;
  insertSnapshot(db, snapshotId, entityId, periodA, storedRoot);

  return { snapshotId, storedRoot };
}

/**
 * Seeds an ANCHORED snapshot whose own period has ZERO current journal_entries
 * rows (e.g. legacy data or a period that never got a JE). The gate must skip
 * (not throw) — absence of JEs is not evidence of a root mismatch.
 */
export function seedAnchoredSnapshotEmptyPeriod(db: Db): { snapshotId: string } {
  const entityId = `ent-${randomUUID()}`;
  insertEntity(db, entityId);
  const snapshotId = `${entityId}-snap1`;
  insertSnapshot(db, snapshotId, entityId, '2026-Q1', 'some-stored-root');
  return { snapshotId };
}
