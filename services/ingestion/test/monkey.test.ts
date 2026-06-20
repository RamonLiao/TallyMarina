/**
 * Adversarial Monkey Tests — deliberate attempts to crash/corrupt the ingestion service.
 * Rules: no production code changes; suite must always terminate.
 */
import { describe, it, expect } from 'vitest';
import { deconstruct } from '../src/core/deconstruct.js';
import { contentHash, canonicalize } from '../src/core/contentHash.js';
import { ingestEntity } from '../src/ingest/ingestEntity.js';
import { FixtureSource } from '../src/source/FixtureSource.js';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { FetchResult, FetchPage } from '../src/domain/types.js';
import type { IngestionSource } from '../src/source/IngestionSource.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const env = (digest: string, rawJson: unknown = {}): FetchResult['txs'][number] =>
  ({ digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson });

// ─── Scenario 1: 50,000 balanceChanges overflow cap ─────────────────────────

describe('[monkey] S1 – 50k balanceChanges overflow cap', () => {
  it('sets overflow=true and caps effects at ≤10,000 without OOM', () => {
    const balanceChanges = Array.from({ length: 50_000 }, (_, i) => ({
      coinType: '0x2::sui::SUI',
      amount: String(i),
      owner: { AddressOwner: `0x${i.toString(16).padStart(64, '0')}` },
    }));

    const envelope = {
      digest: 'overflow-test',
      checkpoint: '1',
      timestampMs: '1',
      status: 'success' as const,
      rawJson: { balanceChanges },
    };

    const { effects, overflow } = deconstruct(envelope);

    expect(overflow).toBe(true);
    expect(effects.length).toBeLessThanOrEqual(10_000);
    // Should not have crashed — reaching here proves no OOM/exception
  });
});

// ─── Scenario 2: Cursor loop (infinite page cycle) ──────────────────────────
//
// FIX [S2 RESOLVED]: ingestEntity now tracks visited cursors in a Set and breaks
// with a cursor_cycle anomaly when a repeat cursor is detected. This test verifies
// the guarded behavior: the loop terminates deterministically without a harness throw.

describe('[monkey] S2 – cursor cycle guard terminates with anomaly', () => {
  it('terminates without hang, returns tally, records cursor_cycle anomaly', async () => {
    let fetchCount = 0;

    const loopSource: IngestionSource = {
      kind: 'fixture' as const,
      async fetchTransactions(_req: FetchPage): Promise<FetchResult> {
        fetchCount++;
        // Alternate between cursor 'c1' and 'c2' endlessly
        const useCursor1 = fetchCount % 2 === 1;
        return {
          txs: [env(`tx-${fetchCount}`)],
          nextCursor: useCursor1 ? 'c2' : 'c1',
          hasNextPage: true, // always claims more pages
        };
      },
      async describe() { return { chainIdentifier: 'test', epoch: 0 }; },
    };

    const repo = new InMemoryRepository();

    // Guard makes it terminate — no throw, no infinite loop
    const result = await ingestEntity({ source: loopSource, repo, entityRef: 'e', address: '0xa' });

    // Should have fetched a small bounded number of pages (null→c2→c1→c2 cycle caught)
    // fetch1: cursor=null→nextCursor=c2, fetch2: cursor=c2→nextCursor=c1, fetch3: cursor=c1→nextCursor=c2 (already visited → break)
    expect(fetchCount).toBe(3);

    // Should have inserted 3 txs (one per page fetched before the cycle was caught)
    expect(result.inserted).toBe(3);

    // Should have recorded exactly 1 cursor_cycle anomaly
    expect(result.anomalies).toBe(1);

    // Verify the anomaly was recorded in the repo
    const anomalies = (repo as unknown as { anomalies: Array<{ kind: string }> }).anomalies;
    expect(anomalies.some((a) => a.kind === 'cursor_cycle')).toBe(true);
  });
});

// ─── Scenario 3: checkpoint beyond Postgres BIGINT ──────────────────────────
//
// NOTE: In-memory path treats checkpoint as a plain string — no numeric parsing
// occurs in this layer. BIGINT overflow only surfaces at the Postgres layer
// (pg driver or DB constraint). This is a documented limitation; no fix needed
// here unless a Postgres repository is in scope.

describe('[monkey] S3 – checkpoint beyond Postgres BIGINT (999999999999999999999)', () => {
  it('schema accepts the value as a digits string and ingest does not crash', async () => {
    const HUGE_CHECKPOINT = '999999999999999999999'; // > PG BIGINT max (9223372036854775807)

    const page: FetchResult = {
      txs: [{
        digest: 'huge-cp-tx',
        checkpoint: HUGE_CHECKPOINT,
        timestampMs: '1000',
        status: 'success',
        rawJson: {},
      }],
      nextCursor: null,
      hasNextPage: false,
    };

    const src = new FixtureSource('cid', 1, [page]);
    const repo = new InMemoryRepository();

    const result = await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });

    expect(result.inserted).toBe(1);
    expect(result.anomalies).toBe(0);

    // DOCUMENTED LIMITATION: If the Postgres repository were used, writing this
    // checkpoint to a BIGINT column would throw a runtime error. The schema
    // validates only that it is a non-negative integer string (/^\d+$/), not
    // that it fits within BIGINT bounds. A Postgres-layer guard (e.g. NUMERIC
    // column type or application-level range check before INSERT) would be
    // needed to handle this safely end-to-end.
  });
});

// ─── Scenario 4: contentHash on a 100-level-deep nested object ──────────────

describe('[monkey] S4 – contentHash on 100-level deep nested object', () => {
  it('terminates and returns a hex string without stack overflow', () => {
    // Build a 100-level deep object: { a: { a: { a: ... } } }
    let deep: unknown = { leaf: 'value' };
    for (let i = 0; i < 100; i++) {
      deep = { a: deep };
    }

    // Should not throw RangeError: Maximum call stack size exceeded
    let result: string | undefined;
    expect(() => {
      result = contentHash(deep);
    }).not.toThrow();

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('canonicalize also handles 100-level deep without stack overflow', () => {
    let deep: unknown = { z: 1, a: 2 };
    for (let i = 0; i < 100; i++) {
      deep = { z: deep, a: i };
    }

    expect(() => canonicalize(deep)).not.toThrow();
  });
});

// ─── Scenario 5: Same digest, two different entityRefs ──────────────────────

describe('[monkey] S5 – same digest under two different entityRefs', () => {
  it('first insert wins; second is duplicate; ownership (entityRef) NOT reassigned', async () => {
    const SHARED_DIGEST = 'shared-digest-xyz';
    const SHARED_RAW_JSON = { balanceChanges: [{ amount: '100' }] };

    const page1: FetchResult = {
      txs: [{ digest: SHARED_DIGEST, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: SHARED_RAW_JSON }],
      nextCursor: null,
      hasNextPage: false,
    };
    const page2: FetchResult = {
      txs: [{ digest: SHARED_DIGEST, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: SHARED_RAW_JSON }],
      nextCursor: null,
      hasNextPage: false,
    };

    const repo = new InMemoryRepository();

    // First entityRef ingests the tx — should insert
    const src1 = new FixtureSource('cid', 1, [page1]);
    const r1 = await ingestEntity({ source: src1, repo, entityRef: 'entity-A', address: '0xa' });
    expect(r1.inserted).toBe(1);
    expect(r1.duplicate).toBe(0);

    // Second entityRef tries to ingest the same digest — should be duplicate
    const src2 = new FixtureSource('cid', 1, [page2]);
    const r2 = await ingestEntity({ source: src2, repo, entityRef: 'entity-B', address: '0xb' });
    expect(r2.inserted).toBe(0);
    expect(r2.duplicate).toBe(1);

    // The stored tx still belongs to entity-A (first writer wins)
    const stored = (repo as unknown as { txs: Map<string, { entityRef: string }> }).txs.get(SHARED_DIGEST);
    expect(stored).toBeDefined();
    expect(stored?.entityRef).toBe('entity-A');
  });
});
