import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/core/buildSnapshot.js';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { RuleOutput, JournalEntry } from '../src/deps/rulesEngine.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'lh', reversalOf: null,
    lines: [
      { account: 'a', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
      { account: 'b', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
    ],
  };
}
function out(decision: RuleOutput['decision'], jes: JournalEntry[], policyVersions: string[]): RuleOutput {
  return {
    decision,
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as RuleOutput['assessment']['eventType'], accountingClass: '', measurementModel: '' },
    measurements: [], lotMovements: [], journalEntries: jes, disclosureFacts: [], exceptions: [],
    explanation: { ruleIds: [], policyVersions, priceRefs: [], fxRefs: [] },
  };
}
const meta = { entityId: 'e1', periodId: '2026-Q2', createdAtLogical: 7 };

describe('buildSnapshot', () => {
  it('happy path: 2 POSTABLE outputs → snapshot + anchorPayload', () => {
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot, anchorPayload } = buildSnapshot(
      [out('POSTABLE', [je('k1')], ['ps-1', 'rule-1']), out('POSTABLE', [je('k2')], ['ps-1', 'rule-2'])],
      meta, repo,
    );
    expect(auditSnapshot.leafCount).toBe(2);
    expect(auditSnapshot.manifest.policyVersions).toEqual(['ps-1', 'rule-1', 'rule-2']); // dedupe+sort
    expect(anchorPayload.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(anchorPayload.merkleRoot).toBe(auditSnapshot.merkleRoot);
    // supersedesSeq=0 means "no prior version" (sentinel); first freeze → seq=1
    expect(anchorPayload.supersedesSeq).toBe(0);
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(1);
  });
  it('filters out non-POSTABLE outputs (not in merkle / policyVersions)', () => {
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot } = buildSnapshot(
      [out('POSTABLE', [je('k1')], ['ps-1']), out('REJECTED', [je('zz')], ['leak']), out('REVIEW_REQUIRED', [je('yy')], ['leak2'])],
      meta, repo,
    );
    expect(auditSnapshot.leafCount).toBe(1);
    expect(auditSnapshot.manifest.policyVersions).toEqual(['ps-1']);
  });
  it('no POSTABLE JE → EMPTY_SNAPSHOT', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('REJECTED', [je('k')], [])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('EMPTY_SNAPSHOT');
  });
  it('POSTABLE output with empty journalEntries (zero-value ITX) → EMPTY_SNAPSHOT when alone', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('POSTABLE', [], ['ps'])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('EMPTY_SNAPSHOT');
  });
  it('duplicate idempotencyKey across outputs → DUPLICATE_IDEMPOTENCY_KEY', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('POSTABLE', [je('dup')], ['a']), out('POSTABLE', [je('dup')], ['b'])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
  });
  it('deterministic: JE order shuffled → identical manifestHash', () => {
    const repo1 = new InMemorySnapshotRepo();
    const repo2 = new InMemorySnapshotRepo();
    const a = buildSnapshot([out('POSTABLE', [je('k1'), je('k2')], ['p'])], meta, repo1).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k2'), je('k1')], ['p'])], meta, repo2).auditSnapshot.manifestHash;
    expect(a).toBe(b);
  });
  it('field-binding: different entityId → different manifestHash', () => {
    const a = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], { ...meta, entityId: 'e2' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('field-binding: different createdAtLogical → different manifestHash', () => {
    const a = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], { ...meta, createdAtLogical: 8 }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('policyVersions with lone surrogate → INVALID_ENCODING', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try {
      buildSnapshot([out('POSTABLE', [je('k1')], ['\uD800'])], meta, repo);
    } catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('INVALID_ENCODING');
  });
  it('restate path: second freeze with restate → supersedesSeq 1 (supersedes v1), repo seq 2', () => {
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, repo);
    const { anchorPayload } = buildSnapshot([out('POSTABLE', [je('k1'), je('k2')], ['p'])], meta, repo, { restate: true });
    // supersedesSeq=1 ≥ 1, so it is unambiguously a superseded real version, not the sentinel
    expect(anchorPayload.supersedesSeq).toBe(1);
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(2);
  });
});
