import { describe, it, expect } from 'vitest';
import { ingestEntity } from '../src/ingest/ingestEntity.js';
import { FixtureSource } from '../src/source/FixtureSource.js';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { FetchResult } from '../src/domain/types.js';

// One page carries a realistic mix: a coin transfer, gas, and an unknown shape.
const realisticPages = (): FetchResult[] => ([
  { txs: [
      { digest: 'T1', checkpoint: '100', timestampMs: '1700000000000', status: 'success',
        rawJson: { balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
                   effects: { gasUsed: { computationCost: '700', storageCost: '300', storageRebate: '100', nonRefundableStorageFee: '0' } } } },
      { digest: 'T2', checkpoint: '101', timestampMs: '1700000001000', status: 'success',
        rawJson: { weird: [{ z: 1 }] } },
    ], nextCursor: null, hasNextPage: false },
]);

describe('acceptance: full path offline (spec §10)', () => {
  it('ingests, is idempotent on re-run, and never drops unknown activity', async () => {
    const repo = new InMemoryRepository();
    const key = { entityRef: 'pilot', address: '0xa', sourceKind: 'fixture' };

    const r1 = await ingestEntity({ source: new FixtureSource('cid', 1, realisticPages()), repo, entityRef: 'pilot', address: '0xa' });
    expect(r1.inserted).toBe(2);

    await repo.setCursor(key, null, null);
    const r2 = await ingestEntity({ source: new FixtureSource('cid', 1, realisticPages()), repo, entityRef: 'pilot', address: '0xa' });
    expect(r2.inserted).toBe(0);
    expect(r2.duplicate).toBe(2);          // §10.2 idempotency: 0 new rows
    expect(repo.dump().size).toBe(2);
  });
});
