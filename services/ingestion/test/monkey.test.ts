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
// FINDING [MEDIUM]: ingestEntity has NO visited-cursor guard. If nextCursor on
// page N points back to a previously-seen cursor and hasNextPage stays true,
// the loop runs forever. The test below confirms the defect safely by counting
// fetches and throwing after a threshold. Production fix needed: track visited
// cursors and break on repeat.

describe('[monkey] S2 – cursor loop detected by fetch counter', () => {
  it('confirmed: loops indefinitely without a guard (bounded by test harness)', async () => {
    // A source that alternates between two cursors indefinitely
    const FETCH_LIMIT = 25; // if we exceed this, the loop is confirmed
    let fetchCount = 0;

    const loopSource: IngestionSource = {
      kind: 'fixture' as const,
      async fetchTransactions(_req: FetchPage): Promise<FetchResult> {
        fetchCount++;
        if (fetchCount > FETCH_LIMIT) {
          throw new Error(`LOOP_DETECTED: fetchTransactions called ${fetchCount} times — no cursor guard`);
        }
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

    // The loop IS expected to throw our sentinel error (confirming the defect).
    // We assert that the error is our sentinel, not a crash from production code.
    await expect(
      ingestEntity({ source: loopSource, repo, entityRef: 'e', address: '0xa' })
    ).rejects.toThrow('LOOP_DETECTED');

    // Confirm it ran more than FETCH_LIMIT times before we killed it
    expect(fetchCount).toBeGreaterThan(FETCH_LIMIT);

    // DEFECT: No visited-cursor guard in ingestEntity. Without the harness
    // throw above, this would hang CI indefinitely.
    // Severity: MEDIUM — requires a malformed/adversarial source to trigger;
    // production Sui RPC sources should not create cursor cycles, but a buggy
    // custom IngestionSource or a compromised fixture would cause an infinite loop.
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
