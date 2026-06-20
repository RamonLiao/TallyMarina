import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PostgresRepository } from '../src/repo/PostgresRepository.js';
import type { RawTransaction } from '../src/domain/types.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

const tx = (digest: string, h: string): RawTransaction => ({
  digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: { a: 1 }, entityRef: 'e', contentHash: h,
});

d('PostgresRepository', () => {
  let repo: PostgresRepository;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await pool.query(readFileSync('src/migrations/001_init.sql', 'utf8'));
    await pool.query('TRUNCATE raw_effect, raw_transaction, ingestion_checkpoint, ingestion_anomaly');
    repo = new PostgresRepository(pool);
  });
  it('insert then duplicate', async () => {
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('inserted');
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('duplicate');
  });
  it('content_mismatch does not overwrite', async () => {
    const r = await repo.insertTxIfAbsent(tx('A', 'h2'), []);
    expect(r).toEqual({ conflict: 'content_mismatch', existingHash: 'h1' });
  });
});
