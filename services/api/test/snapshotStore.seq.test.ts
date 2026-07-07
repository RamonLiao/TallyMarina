import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertSnapshot, getSnapshot, getLatestSnapshot, getLatestSnapshotSeq, listSnapshotsForPeriod,
} from '../src/store/snapshotStore.js';

const E = 'ent-1', P = '2026-Q2';
function seed(db: Db) {
  insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
}
function row(seq: number, root: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: `snap-${E}-${P}-${seq}`, entityId: E, periodId: P,
    manifestJson: JSON.stringify({ merkleRoot: root }), manifestHash: `mh-${seq}`,
    merkleRoot: root, leafCount: 3, seq, supersedesSeq: seq === 1 ? null : seq - 1,
    ...extra,
  };
}

describe('snapshot seq + provenance store', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('persists seq and returns latest by seq', () => {
    insertSnapshot(db, row(1, 'aa'));
    insertSnapshot(db, row(2, 'bb'));
    expect(getLatestSnapshotSeq(db, E, P)).toBe(2);
    expect(getLatestSnapshot(db, E, P)!.merkleRoot).toBe('bb');
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.seq).toBe(1);
    expect(listSnapshotsForPeriod(db, E, P).map((r) => r.seq)).toEqual([1, 2]);
  });

  it('getLatestSnapshotSeq is 0 when none', () => {
    expect(getLatestSnapshotSeq(db, E, P)).toBe(0);
  });

  it('UNIQUE(entity,period,seq) rejects duplicate seq', () => {
    insertSnapshot(db, row(1, 'aa'));
    expect(() => insertSnapshot(db, row(1, 'cc'))).toThrow(/UNIQUE constraint failed/);
  });

  it('round-trips restatement provenance', () => {
    insertSnapshot(db, row(2, 'bb', {
      restatementReasonCode: 'error-correction', restatementReason: 'wrong price',
      affectedAmountEstimate: '1000', restatementRequestedBy: 'alice', restatementApprovedBy: 'bob',
    }));
    const got = getLatestSnapshot(db, E, P)!;
    // Assert all 5 fields — a column-order bug in the INSERT/SELECT would only surface
    // if every provenance column is read back (distinct values, no positional aliasing).
    expect(got.restatementReasonCode).toBe('error-correction');
    expect(got.restatementReason).toBe('wrong price');
    expect(got.affectedAmountEstimate).toBe('1000');
    expect(got.restatementRequestedBy).toBe('alice');
    expect(got.restatementApprovedBy).toBe('bob');
  });
});
