import type { MemoryMode } from '../../config.js';

export interface RecallFeatures {
  eventType: string | null;
  category: string;
  amountBand: string;
}

export interface MemoryRecord {
  entityId: string;
  eventType: string | null;
  category: string;
  amountBand: string;
  outcome: 'ACCEPTED' | 'REJECTED';
  action: string;
  reasonCode: string;
  note: string | null;
}

export interface MemoryHit {
  text: string;
  distance?: number;
}

export interface RecallContext {
  mode: MemoryMode;
  namespace: string;
  query: string;
  hits: MemoryHit[];
}

export interface MemoryClient {
  /** Advisory precedent for classify. Fail-open: implementations must never throw. */
  recall(input: { entityId: string; query: string; features: RecallFeatures; limit: number }): Promise<MemoryHit[]>;
  /** Write-back a human decision. Fire-and-forget at call site. */
  remember(input: { entityId: string; record: MemoryRecord }): Promise<void>;
  /** Startup readiness. memwal: compatibility()/health() — THROWS on failure (fail-loud). off/local: no-op. */
  probe(): Promise<void>;
  /** Lifecycle teardown. memwal: destroy() cached instances. off/local: no-op. */
  close(): Promise<void>;
}
