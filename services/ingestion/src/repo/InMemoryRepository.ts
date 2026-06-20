import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';
import type { Repository, CursorKey, InsertResult } from './Repository.js';

const ck = (k: CursorKey) => `${k.entityRef}|${k.address}|${k.sourceKind}`;

export class InMemoryRepository implements Repository {
  private txs = new Map<string, RawTransaction>();
  private effects = new Map<string, RawEffect[]>();
  private cursors = new Map<string, { cursor: string | null; lastCheckpoint: string | null }>();
  readonly anomalies: IngestionAnomaly[] = [];

  async insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult> {
    const existing = this.txs.get(tx.digest);
    if (existing) {
      if (existing.contentHash === tx.contentHash) return 'duplicate';
      return { conflict: 'content_mismatch', existingHash: existing.contentHash };
    }
    this.txs.set(tx.digest, tx);
    this.effects.set(tx.digest, effects);
    return 'inserted';
  }
  async getCursor(key: CursorKey) { return this.cursors.get(ck(key)) ?? null; }
  async setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null) {
    this.cursors.set(ck(key), { cursor, lastCheckpoint });
  }
  async recordAnomaly(a: IngestionAnomaly) { this.anomalies.push(a); }
  dump() { return this.txs; }
}
