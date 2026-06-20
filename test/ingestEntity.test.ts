import { describe, it, expect } from 'vitest';
import { ingestEntity } from '../src/ingest/ingestEntity.js';
import { FixtureSource } from '../src/source/FixtureSource.js';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { FetchResult } from '../src/domain/types.js';

const env = (digest: string, rawJson: unknown = {}): FetchResult['txs'][number] =>
  ({ digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson });

const twoPages = (): FetchResult[] => ([
  { txs: [env('A'), env('B')], nextCursor: 'c1', hasNextPage: true },
  { txs: [env('C')], nextCursor: null, hasNextPage: false },
]);

describe('ingestEntity', () => {
  it('ingests all pages and persists each tx once', async () => {
    const repo = new InMemoryRepository();
    const src = new FixtureSource('cid', 1, twoPages());
    const r = await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    expect(r.inserted).toBe(3);
    expect(r.pages).toBe(2);
  });

  it('is idempotent: a second run inserts nothing new', async () => {
    const repo = new InMemoryRepository();
    const src = new FixtureSource('cid', 1, twoPages());
    await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    // reset cursor to force a full re-scan from the start
    await repo.setCursor({ entityRef: 'e', address: '0xa', sourceKind: 'fixture' }, null, null);
    const r2 = await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    expect(r2.inserted).toBe(0);
    expect(r2.duplicate).toBe(3);
  });

  it('records content_mismatch anomaly and keeps the original', async () => {
    const repo = new InMemoryRepository();
    const first = new FixtureSource('cid', 1, [{ txs: [env('A', { x: 1 })], nextCursor: null, hasNextPage: false }]);
    const second = new FixtureSource('cid', 1, [{ txs: [env('A', { x: 999 })], nextCursor: null, hasNextPage: false }]);
    await ingestEntity({ source: first, repo, entityRef: 'e', address: '0xa' });
    await repo.setCursor({ entityRef: 'e', address: '0xa', sourceKind: 'fixture' }, null, null);
    const r = await ingestEntity({ source: second, repo, entityRef: 'e', address: '0xa' });
    expect(r.anomalies).toBe(1);
    expect(repo.anomalies[0].kind).toBe('content_mismatch');
  });
});
