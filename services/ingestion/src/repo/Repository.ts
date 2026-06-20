import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';

export type CursorKey = { entityRef: string; address: string; sourceKind: string };
export type InsertResult = 'inserted' | 'duplicate' | { conflict: 'content_mismatch'; existingHash: string };

export interface Repository {
  insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult>;
  getCursor(key: CursorKey): Promise<{ cursor: string | null; lastCheckpoint: string | null } | null>;
  setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null): Promise<void>;
  recordAnomaly(a: IngestionAnomaly): Promise<void>;
}
