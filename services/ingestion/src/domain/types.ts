export type EffectKind =
  | 'coin_balance_change' | 'object_transfer' | 'gas' | 'staking' | 'event' | 'unknown';

export interface RawEffect {
  rawIndex: number;
  kind: EffectKind;
  coinType?: string;
  amount?: string;      // minor-unit integer as string; never a JS number
  decimals?: number;
  counterparty?: string;
  objectId?: string;
  rawRef?: string;      // pointer back into rawJson for re-derive (esp. 'unknown')
}

export interface RawTxEnvelope {
  digest: string;
  checkpoint: string;   // bigint-as-string
  timestampMs: string;  // bigint-as-string; validator checkpoint time
  status: 'success' | 'failure';
  rawJson: unknown;
}

export interface RawTransaction extends RawTxEnvelope {
  entityRef: string;
  contentHash: string;
}

export interface FetchPage { entityRef: string; address: string; cursor: string | null; limit: number; }
export interface FetchResult { txs: RawTxEnvelope[]; nextCursor: string | null; hasNextPage: boolean; }

export type AnomalyKind = 'content_mismatch' | 'retention_gap' | 'effect_overflow';
export interface IngestionAnomaly { digest: string | null; entityRef: string; kind: AnomalyKind; detail: unknown; }
