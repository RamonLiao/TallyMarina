import type { FetchPage, FetchResult } from '../domain/types.js';
import type { IngestionSource } from './IngestionSource.js';

export class FixtureSource implements IngestionSource {
  readonly kind = 'fixture' as const;
  // pages are consumed in order; first page answers cursor=null, each page's
  // nextCursor is the key to the following page.
  private byCursor = new Map<string | null, FetchResult>();

  constructor(private chainId: string, private epoch: number, pages: FetchResult[]) {
    let key: string | null = null;
    for (const page of pages) {
      this.byCursor.set(key, page);
      key = page.nextCursor;
    }
  }

  async fetchTransactions(req: FetchPage): Promise<FetchResult> {
    return this.byCursor.get(req.cursor)
      ?? { txs: [], nextCursor: null, hasNextPage: false };
  }

  async describe() { return { chainIdentifier: this.chainId, epoch: this.epoch }; }
}
