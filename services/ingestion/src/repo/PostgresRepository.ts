import type { Pool } from 'pg';
import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';
import type { Repository, CursorKey, InsertResult } from './Repository.js';

export class PostgresRepository implements Repository {
  constructor(private pool: Pool) {}

  async insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO raw_transaction (digest, entity_ref, checkpoint, timestamp_ms, status, raw_json, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (digest) DO NOTHING`,
        [tx.digest, tx.entityRef, tx.checkpoint, tx.timestampMs, tx.status, tx.rawJson, tx.contentHash],
      );
      if (ins.rowCount === 0) {
        const row = await client.query('SELECT content_hash FROM raw_transaction WHERE digest=$1', [tx.digest]);
        const existingHash = row.rows[0].content_hash as string;
        await client.query('COMMIT');
        return existingHash === tx.contentHash ? 'duplicate' : { conflict: 'content_mismatch', existingHash };
      }
      for (const e of effects) {
        await client.query(
          `INSERT INTO raw_effect (digest, raw_index, kind, coin_type, amount, decimals, counterparty, object_id, raw_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (digest, raw_index) DO NOTHING`,
          [tx.digest, e.rawIndex, e.kind, e.coinType ?? null, e.amount ?? null, e.decimals ?? null,
           e.counterparty ?? null, e.objectId ?? null, e.rawRef ?? null],
        );
      }
      await client.query('COMMIT');
      return 'inserted';
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCursor(key: CursorKey) {
    const r = await this.pool.query(
      `SELECT last_cursor, last_checkpoint FROM ingestion_checkpoint
       WHERE entity_ref=$1 AND address=$2 AND source_kind=$3`,
      [key.entityRef, key.address, key.sourceKind],
    );
    if (r.rowCount === 0) return null;
    return { cursor: r.rows[0].last_cursor, lastCheckpoint: r.rows[0].last_checkpoint?.toString() ?? null };
  }

  async setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null) {
    await this.pool.query(
      `INSERT INTO ingestion_checkpoint (entity_ref, address, source_kind, last_cursor, last_checkpoint, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (entity_ref, address, source_kind)
       DO UPDATE SET last_cursor=EXCLUDED.last_cursor, last_checkpoint=EXCLUDED.last_checkpoint, updated_at=now()`,
      [key.entityRef, key.address, key.sourceKind, cursor, lastCheckpoint],
    );
  }

  async recordAnomaly(a: IngestionAnomaly) {
    await this.pool.query(
      `INSERT INTO ingestion_anomaly (digest, entity_ref, kind, detail) VALUES ($1,$2,$3,$4)`,
      [a.digest, a.entityRef, a.kind, a.detail],
    );
  }
}
