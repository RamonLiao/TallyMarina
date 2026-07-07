import { describe, it, expect } from 'vitest';
import { assembleExport } from './assembleExport';

const base = {
  entityId: 'e', periodId: '2026-Q2', functionalCurrency: 'USD', scale: 2,
  generatedAt: '2026-07-06T00:00:00Z', events: [], anchors: [],
  fetchProof: async () => ({ anchors: [], inclusionProof: null }),
};

describe('assembleExport restatement disclosure (C-F3)', () => {
  it('returns stale-restatement when anchorStaleness.stale, not an opaque error', async () => {
    const out = await assembleExport({
      ...base,
      journal: [{ je: { idempotencyKey: 'k1' }, leafHash: 'x' } as never],
      anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aa', currentRoot: 'bb', latestSnapshotSeq: 1 },
    });
    expect(out.ok).toBe(false);
    expect((out as { kind: string }).kind).toBe('stale-restatement');
    expect((out as { anchoredSeq: number }).anchoredSeq).toBe(1);
  });

  it('empty journal still short-circuits to empty regardless of staleness', async () => {
    const out = await assembleExport({ ...base, journal: [], anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aa', currentRoot: null, latestSnapshotSeq: 1 } });
    expect((out as { kind: string }).kind).toBe('empty');
  });
});
