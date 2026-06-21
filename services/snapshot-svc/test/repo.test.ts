import { describe, it, expect } from 'vitest';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { AuditSnapshot } from '../src/domain/types.js';

function base(): Omit<AuditSnapshot, 'seq' | 'supersedesSeq'> {
  return {
    entityId: 'e1', periodId: '2026-Q2',
    manifest: {
      manifestVersion: 'SNAPSHOT_MANIFEST_BCS_V1', entityId: 'e1', periodId: '2026-Q2',
      merkleRoot: 'aa'.repeat(32), leafCount: 1, leafCodecVersion: 'JE_LEAF_BCS_V1',
      merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
      policyVersions: ['a'], createdAtLogical: 0,
    },
    manifestHash: 'bb'.repeat(32), merkleRoot: 'aa'.repeat(32), leafCount: 1,
  };
}

describe('InMemorySnapshotRepo', () => {
  it('first freeze → seq 0, supersedesSeq null, created true', () => {
    const r = new InMemorySnapshotRepo();
    const res = r.freeze(base());
    expect(res.created).toBe(true);
    expect(res.snapshot.seq).toBe(0);
    expect(res.snapshot.supersedesSeq).toBeNull();
  });
  it('re-freeze same period without restate → SNAPSHOT_EXISTS', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    let code = 'NO_THROW';
    try { r.freeze(base()); } catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('SNAPSHOT_EXISTS');
  });
  it('restate → seq increments, supersedesSeq points to prev', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    const res = r.freeze(base(), { restate: true });
    expect(res.snapshot.seq).toBe(1);
    expect(res.snapshot.supersedesSeq).toBe(0);
    expect(r.get('e1', '2026-Q2')?.seq).toBe(1);
  });
  it('get on unknown key → null', () => {
    expect(new InMemorySnapshotRepo().get('x', 'y')).toBeNull();
  });
  it('REGRESSION: pipe-char collision — keyOf("a|b","c") must not alias keyOf("a","b|c")', () => {
    // Old `${entityId}|${periodId}` key: both pairs produce "a|b|c" → same slot.
    // JSON tuple key: ["a|b","c"] vs ["a","b|c"] → distinct slots.
    // This test MUST fail against the old "|" implementation.
    const r = new InMemorySnapshotRepo();
    const snap1 = { ...base(), entityId: 'a|b', periodId: 'c', manifest: { ...base().manifest, entityId: 'a|b', periodId: 'c' } };
    const snap2 = { ...base(), entityId: 'a', periodId: 'b|c', manifest: { ...base().manifest, entityId: 'a', periodId: 'b|c' } };
    const res1 = r.freeze(snap1);
    const res2 = r.freeze(snap2); // must NOT throw SNAPSHOT_EXISTS
    expect(res1.snapshot.seq).toBe(0);
    expect(res2.snapshot.seq).toBe(0);
    expect(res1.created).toBe(true);
    expect(res2.created).toBe(true);
  });
  it('distinct periods isolated', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    const res = r.freeze({ ...base(), periodId: '2026-Q3', manifest: { ...base().manifest, periodId: '2026-Q3' } });
    expect(res.snapshot.seq).toBe(0);
  });
  it('immutability: mutating returned snapshot or input after freeze must not corrupt stored snapshot', () => {
    const r = new InMemorySnapshotRepo();
    const input = base();
    const { snapshot: returned } = r.freeze(input);
    // mutate the returned snapshot's policyVersions
    returned.manifest.policyVersions.push('INJECTED');
    // mutate the original input's policyVersions
    input.manifest.policyVersions.push('ALSO_INJECTED');
    // stored snapshot must still have exactly ['a']
    const stored = r.get('e1', '2026-Q2')!;
    expect(stored.manifest.policyVersions).toEqual(['a']);
  });
});
