import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/core/buildSnapshot.js';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { RuleOutput, JournalEntry } from '../src/deps/rulesEngine.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'lh', reversalOf: null,
    lines: [
      { account: 'a', side: 'DEBIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
      { account: 'b', side: 'CREDIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
    ],
  };
}
function out(jes: JournalEntry[], pv: string[] = ['p']): RuleOutput {
  return {
    decision: 'POSTABLE',
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as RuleOutput['assessment']['eventType'], accountingClass: '', measurementModel: '' },
    measurements: [], lotMovements: [], journalEntries: jes, disclosureFacts: [], exceptions: [],
    explanation: { ruleIds: [], policyVersions: pv, priceRefs: [], fxRefs: [] },
  };
}
const meta = { entityId: 'e1', periodId: '2026-Q2', createdAtLogical: 1 };

describe('snapshot-svc monkey', () => {
  it('large set: 5000 JE → stable root + deterministic across reorder', () => {
    const outs = Array.from({ length: 5000 }, (_, i) => out([je(`k-${String(i).padStart(5, '0')}`)]));
    const a = buildSnapshot(outs, meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([...outs].reverse(), meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).toBe(b);
  });
  it('very long policyVersions list → dedupes massively', () => {
    const pv = Array.from({ length: 10000 }, (_, i) => `pv-${i % 3}`); // only 3 distinct
    const { auditSnapshot } = buildSnapshot([out([je('k')], pv)], meta, new InMemorySnapshotRepo());
    expect(auditSnapshot.manifest.policyVersions).toEqual(['pv-0', 'pv-1', 'pv-2']);
  });
  it('unicode entityId (valid UTF-8) → succeeds + binds into hash', () => {
    const a = buildSnapshot([out([je('k')])], { ...meta, entityId: '實體-🚀' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out([je('k')])], { ...meta, entityId: '實體-🛸' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('periodId exactly 64 bytes passes; 65 fails', () => {
    const ok = buildSnapshot([out([je('k')])], { ...meta, periodId: 'x'.repeat(64) }, new InMemorySnapshotRepo());
    expect(ok.auditSnapshot.periodId.length).toBe(64);
    let code = 'NO_THROW';
    try { buildSnapshot([out([je('k')])], { ...meta, periodId: 'x'.repeat(65) }, new InMemorySnapshotRepo()); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('PERIOD_ID_TOO_LONG');
  });
  it('repeated freeze same repo without restate stays fail-closed across many attempts', () => {
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out([je('k')])], meta, repo);
    for (let i = 0; i < 50; i++) {
      let code = 'NO_THROW';
      try { buildSnapshot([out([je('k')])], meta, repo); }
      catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
      expect(code).toBe('SNAPSHOT_EXISTS');
    }
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(1); // 未被污染；first freeze seq=1
  });
  it('many restatements → monotonic seq + supersedesSeq chain', () => {
    // 0 is the reserved no-prior-version sentinel; valid version seq starts at 1
    // so a restatement's supersedesSeq can never collide with it.
    // After first freeze: seq=1. i-th restatement (i=1..10): seq=i+1, supersedesSeq=i (always ≥1).
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out([je('k')])], meta, repo);
    for (let i = 1; i <= 10; i++) {
      const { anchorPayload } = buildSnapshot([out([je('k')], [`p${i}`])], meta, repo, { restate: true });
      expect(anchorPayload.supersedesSeq).toBe(i); // supersedes version i (≥1, never 0 sentinel)
    }
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(11);
  });
});
