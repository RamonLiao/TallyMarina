import { describe, it, expect } from 'vitest';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { FreezeInput } from '../src/repo/snapshotRepo.js';
import type { SnapshotManifestStruct } from '../src/domain/types.js';

function manifestOf(entityId: string, periodId: string): SnapshotManifestStruct {
  return {
    manifestVersion: 'SNAPSHOT_MANIFEST_BCS_V1', entityId, periodId,
    merkleRoot: 'aa'.repeat(32), leafCount: 1, leafCodecVersion: 'JE_LEAF_BCS_V1',
    merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
    policyVersions: ['a'], createdAtLogical: 0,
  };
}

function base(): FreezeInput {
  return { manifest: manifestOf('e1', '2026-Q2'), manifestHash: 'bb'.repeat(32) };
}

describe('InMemorySnapshotRepo', () => {
  it('first freeze → seq 1, supersedesSeq null, created true', () => {
    // 0 is the reserved no-prior-version sentinel; valid version seq starts at 1
    // so a restatement's supersedesSeq can never collide with it.
    const r = new InMemorySnapshotRepo();
    const res = r.freeze(base());
    expect(res.created).toBe(true);
    expect(res.snapshot.seq).toBe(1);
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
    expect(res.snapshot.seq).toBe(2);
    expect(res.snapshot.supersedesSeq).toBe(1);
    expect(r.get('e1', '2026-Q2')?.seq).toBe(2);
  });
  it('get on unknown key → null', () => {
    expect(new InMemorySnapshotRepo().get('x', 'y')).toBeNull();
  });
  it('REGRESSION: pipe-char collision — keyOf("a|b","c") must not alias keyOf("a","b|c")', () => {
    // Old `${entityId}|${periodId}` key: both pairs produce "a|b|c" → same slot.
    // JSON tuple key: ["a|b","c"] vs ["a","b|c"] → distinct slots.
    // This test MUST fail against the old "|" implementation.
    const r = new InMemorySnapshotRepo();
    const snap1: FreezeInput = { ...base(), manifest: manifestOf('a|b', 'c') };
    const snap2: FreezeInput = { ...base(), manifest: manifestOf('a', 'b|c') };
    const res1 = r.freeze(snap1);
    const res2 = r.freeze(snap2); // must NOT throw SNAPSHOT_EXISTS
    expect(res1.snapshot.seq).toBe(1);
    expect(res2.snapshot.seq).toBe(1);
    expect(res1.created).toBe(true);
    expect(res2.created).toBe(true);
  });
  it('distinct periods isolated', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    const res = r.freeze({ ...base(), manifest: manifestOf('e1', '2026-Q3') });
    expect(res.snapshot.seq).toBe(1);
  });
  it('HARDENING: top-level entityId/periodId/merkleRoot/leafCount are derived from manifest, never drift', () => {
    // Why: AuditSnapshot duplicates these fields at top level and inside manifest. The old
    // freeze() took them as separate inputs, so a caller could store an internally
    // inconsistent snapshot (top-level merkleRoot != manifest.merkleRoot). The input type
    // now only accepts {manifest, manifestHash}; the mirror fields are derived. This test
    // pins that derivation — if freeze ever reads mirror fields from elsewhere, it fails.
    const r = new InMemorySnapshotRepo();
    const manifest = manifestOf('acme', '2026-Q4');
    manifest.merkleRoot = 'cd'.repeat(32);
    manifest.leafCount = 7;
    const { snapshot } = r.freeze({ manifest, manifestHash: 'ef'.repeat(32) });
    expect(snapshot.entityId).toBe(manifest.entityId);
    expect(snapshot.periodId).toBe(manifest.periodId);
    expect(snapshot.merkleRoot).toBe(manifest.merkleRoot);
    expect(snapshot.leafCount).toBe(manifest.leafCount);
    expect(snapshot.manifestHash).toBe('ef'.repeat(32));
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
