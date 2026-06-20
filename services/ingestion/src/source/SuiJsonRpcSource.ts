import type { FetchPage, FetchResult, RawTxEnvelope } from '../domain/types.js';
import type { IngestionSource } from './IngestionSource.js';

// Structural subset of @mysten/sui SuiClient — keeps tests offline and
// insulates us from the throwaway JSON-RPC surface (spec §4.1).
export interface SuiClientLike {
  getChainIdentifier(): Promise<string>;
  getLatestSuiSystemState(): Promise<{ epoch: string }>;
  queryTransactionBlocks(args: unknown): Promise<{ data: any[]; nextCursor: string | null; hasNextPage: boolean }>;
}

export class SuiJsonRpcSource implements IngestionSource {
  readonly kind = 'sui-jsonrpc' as const;
  constructor(private client: SuiClientLike, private expectedChainId: string) {}

  async fetchTransactions(req: FetchPage): Promise<FetchResult> {
    const res = await this.client.queryTransactionBlocks({
      filter: { FromOrToAddress: { addr: req.address } },
      options: { showEffects: true, showBalanceChanges: true, showObjectChanges: true, showEvents: true, showInput: true },
      cursor: req.cursor, limit: req.limit, order: 'ascending',
    });
    const txs: RawTxEnvelope[] = res.data.map((r) => ({
      digest: String(r.digest),
      checkpoint: String(r.checkpoint ?? '0'),
      timestampMs: String(r.timestampMs ?? '0'),
      status: r?.effects?.status?.status === 'success' ? 'success' : 'failure',
      rawJson: r,
    }));
    return { txs, nextCursor: res.nextCursor, hasNextPage: res.hasNextPage };
  }

  async describe() {
    const chainIdentifier = await this.client.getChainIdentifier();
    if (chainIdentifier !== this.expectedChainId) {
      throw new Error(`chain identifier mismatch: got ${chainIdentifier}, expected ${this.expectedChainId}`);
    }
    const state = await this.client.getLatestSuiSystemState();
    return { chainIdentifier, epoch: Number(state.epoch) };
  }
}
