import type { FetchPage, FetchResult } from '../domain/types.js';

export interface IngestionSource {
  readonly kind: 'sui-jsonrpc' | 'sui-grpc' | 'sui-graphql' | 'fixture';
  fetchTransactions(req: FetchPage): Promise<FetchResult>;
  describe(): Promise<{ chainIdentifier: string; epoch: number }>;
}
