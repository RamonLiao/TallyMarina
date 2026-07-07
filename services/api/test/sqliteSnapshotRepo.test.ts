import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { SqliteSnapshotRepo } from '../src/store/sqliteSnapshotRepo.js';
import { getSnapshot } from '../src/store/snapshotStore.js';
import { SnapshotError } from '@subledger/snapshot-svc';

const E = 'ent-1', P = '2026-Q2';
function manifest(root: string) {
  return {
    manifestVersion: 1, entityId: E, periodId: P, merkleRoot: root, leafCount: 3,
    leafCodecVersion: 'JE_LEAF_BCS_V1', merkleParams: { hash: 'blake2b256', arity: 2 },
    policyVersions: ['demo-ps-1'], createdAtLogical: 100,
  };
}
function seed(db: Db) { insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0xp' }); }

describe('SqliteSnapshotRepo — AuditSnapshotRepo contract', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('first freeze → seq=1, supersedesSeq=null, created=true', () => {
    const repo = new SqliteSnapshotRepo(db);
    const { snapshot, created } = repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    expect(created).toBe(true);
    expect(snapshot.seq).toBe(1);
    expect(snapshot.supersedesSeq).toBeNull();
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.merkleRoot).toBe('aa');
  });

  it('re-freeze without restate → throws SNAPSHOT_EXISTS', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    expect(() => repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }))
      .toThrow(SnapshotError);
  });

  it('restate → seq=2, supersedesSeq=1', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    const { snapshot } = repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(snapshot.seq).toBe(2);
    expect(snapshot.supersedesSeq).toBe(1);
  });

  it('restate writes injected provenance onto the new row only', () => {
    new SqliteSnapshotRepo(db).freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    const repo = new SqliteSnapshotRepo(db, {
      reasonCode: 'error-correction', reason: 'bad price', affectedAmountEstimate: '999',
      requestedBy: 'alice', approvedBy: 'bob',
    });
    repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.restatementReasonCode).toBeNull();
    expect(getSnapshot(db, `snap-${E}-${P}-2`)!.restatementReasonCode).toBe('error-correction');
    expect(getSnapshot(db, `snap-${E}-${P}-2`)!.restatementApprovedBy).toBe('bob');
  });

  it('get returns latest version', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(repo.get(E, P)!.merkleRoot).toBe('bb');
    expect(repo.get(E, P)!.seq).toBe(2);
  });

  it('get on corrupt manifest_json throws (fail-loud)', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    db.prepare('UPDATE snapshots SET manifest_json = ? WHERE id = ?').run('{not json', `snap-${E}-${P}-1`);
    expect(() => repo.get(E, P)).toThrow();
  });
});
