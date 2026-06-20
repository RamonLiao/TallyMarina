import { describe, it, expect } from 'vitest';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { RawTransaction } from '../src/domain/types.js';

const tx = (digest: string, contentHash: string): RawTransaction => ({
  digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: {}, entityRef: 'e', contentHash,
});

describe('InMemoryRepository idempotency', () => {
  it('inserts once, reports duplicate on identical re-insert', async () => {
    const repo = new InMemoryRepository();
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('inserted');
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('duplicate');
  });
  it('flags content_mismatch without overwriting the original', async () => {
    const repo = new InMemoryRepository();
    await repo.insertTxIfAbsent(tx('A', 'h1'), []);
    const r = await repo.insertTxIfAbsent(tx('A', 'h2'), []);
    expect(r).toEqual({ conflict: 'content_mismatch', existingHash: 'h1' });
    expect(repo.dump().get('A')!.contentHash).toBe('h1'); // unchanged
  });
  it('round-trips cursor by key', async () => {
    const repo = new InMemoryRepository();
    const key = { entityRef: 'e', address: '0xa', sourceKind: 'fixture' };
    await repo.setCursor(key, 'c1', '50');
    expect(await repo.getCursor(key)).toEqual({ cursor: 'c1', lastCheckpoint: '50' });
  });
});
