import { describe, it, expect } from 'vitest';
import { FixtureSource } from '../src/source/FixtureSource.js';
import type { FetchResult } from '../src/domain/types.js';

const env = (digest: string): FetchResult['txs'][number] =>
  ({ digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: {} });

describe('FixtureSource', () => {
  const pages: FetchResult[] = [
    { txs: [env('A'), env('B')], nextCursor: 'c1', hasNextPage: true },
    { txs: [env('C')], nextCursor: null, hasNextPage: false },
  ];
  const src = new FixtureSource('4btiuiKKaR9P', 100, pages);

  it('serves the first page when cursor is null', async () => {
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: null, limit: 50 });
    expect(r.txs.map(t => t.digest)).toEqual(['A', 'B']);
    expect(r.nextCursor).toBe('c1');
  });
  it('serves the next page by cursor', async () => {
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: 'c1', limit: 50 });
    expect(r.txs.map(t => t.digest)).toEqual(['C']);
    expect(r.hasNextPage).toBe(false);
  });
  it('describe() returns the configured chain identifier', async () => {
    expect((await src.describe()).chainIdentifier).toBe('4btiuiKKaR9P');
  });
});
