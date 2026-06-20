import type { IngestionSource } from '../source/IngestionSource.js';
import type { Repository } from '../repo/Repository.js';
import type { RawTransaction, RawTxEnvelope } from '../domain/types.js';
import { rawTxEnvelopeSchema } from '../domain/schemas.js';
import { contentHash } from '../core/contentHash.js';
import { deconstruct } from '../core/deconstruct.js';

export async function ingestEntity(args: {
  source: IngestionSource; repo: Repository; entityRef: string; address: string; pageLimit?: number;
}): Promise<{ inserted: number; duplicate: number; anomalies: number; pages: number }> {
  const { source, repo, entityRef, address } = args;
  const pageLimit = args.pageLimit ?? 50;
  const key = { entityRef, address, sourceKind: source.kind };
  const stored = await repo.getCursor(key);
  let cursor = stored?.cursor ?? null;

  let inserted = 0, duplicate = 0, anomalies = 0, pages = 0;

  for (;;) {
    const page = await source.fetchTransactions({ entityRef, address, cursor, limit: pageLimit });
    pages++;
    for (const env of page.txs) {
      const parsed = rawTxEnvelopeSchema.parse(env) as RawTxEnvelope;
      const tx: RawTransaction = { ...parsed, entityRef, contentHash: contentHash(parsed.rawJson) };
      const { effects, overflow } = deconstruct(parsed);
      if (overflow) {
        await repo.recordAnomaly({ digest: tx.digest, entityRef, kind: 'effect_overflow', detail: { effects: effects.length } });
        anomalies++;
      }
      const res = await repo.insertTxIfAbsent(tx, effects);
      if (res === 'inserted') inserted++;
      else if (res === 'duplicate') duplicate++;
      else {
        await repo.recordAnomaly({ digest: tx.digest, entityRef, kind: 'content_mismatch', detail: { existingHash: res.existingHash, newHash: tx.contentHash } });
        anomalies++;
      }
    }
    // advance cursor only after the page is fully persisted
    await repo.setCursor(key, page.nextCursor, page.txs.at(-1)?.checkpoint ?? stored?.lastCheckpoint ?? null);
    cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  }
  return { inserted, duplicate, anomalies, pages };
}
