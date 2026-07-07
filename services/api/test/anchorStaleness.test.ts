// services/api/test/anchorStaleness.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot, setSnapshotStatus } from '../src/store/snapshotStore.js';
import { deriveAnchorStaleness } from '../src/periodLock/anchorStaleness.js';
import { insertJournalRow } from './helpers/journal.js'; // thin helper: insert a JE row for (entity,period)

const E = 'ent-1', P = '2026-Q2';
function seed(db: Db) { insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }); }
// snapRoot: compute the buildMerkle root of the current journal so tests match reality.

describe('deriveAnchorStaleness', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('null when never anchored', () => {
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: 'aa', leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    expect(deriveAnchorStaleness(db, E, P)).toBeNull();
  });

  it('stale=false when current root matches latest ANCHORED root', () => {
    const { root } = insertJournalRow(db, E, P); // returns the buildMerkle root of that one JE
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(false);
    expect(s.anchoredSeq).toBe(1);
    expect(s.latestSnapshotSeq).toBe(1);
    expect(s.anchoredRoot).toBe(root);
    expect(s.currentRoot).toBe(root);
  });

  it('stale=true after books change (reopen+edit, not yet re-frozen)', () => {
    const { root } = insertJournalRow(db, E, P, { amount: '100' });
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    insertJournalRow(db, E, P, { amount: '250' }); // books changed → root differs
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);
    expect(s.latestSnapshotSeq).toBe(1); // not yet re-frozen
  });

  it('stale=true when re-frozen (seq 2 FROZEN) but not yet re-anchored; latestSnapshotSeq=2', () => {
    const { root: r1 } = insertJournalRow(db, E, P, { amount: '100' });
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: r1, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    const { root: r2 } = insertJournalRow(db, E, P, { amount: '250' });
    insertSnapshot(db, { id: `snap-${E}-${P}-2`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h2', merkleRoot: r2, leafCount: 2, supersedesSeq: 1, seq: 2, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);            // latest ANCHORED is still seq1's root
    expect(s.anchoredSeq).toBe(1);
    expect(s.latestSnapshotSeq).toBe(2);
  });

  it('empty journal ⇒ stale=true, does not throw EMPTY_SNAPSHOT (S-F4)', () => {
    const { root } = insertJournalRow(db, E, P);
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    db.prepare('DELETE FROM journal_entries WHERE entity_id = ?').run(E);
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);
    expect(s.currentRoot).toBeNull();
  });
});
