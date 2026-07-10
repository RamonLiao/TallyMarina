import type { Db } from '../store/db.js';
import { canonicalCoinType } from './normalize.js';
import { getAsset, type AssetSource } from './store.js';

export interface AssetInfo {
  decimals: number;
  symbol: string;
  displayName: string;
  source: AssetSource;
}

/**
 * The registry read. Synchronous, no network — safe on the ingest hot path.
 *
 * Returns null for an unregistered asset. It must NEVER supply a default: the entire point
 * of this table is that "we don't know this asset's scale" is a real, representable state.
 * A malformed coinType also reads as null rather than throwing, so a legacy row cannot
 * crash a read path.
 *
 * Asymmetric on purpose vs. `countAssetUsage` (the destructive-op gate in store.ts), which
 * throws `CoinTypeError` on the same kind of bad input instead of returning a safe-looking
 * value. That gate guards a delete: turning "I can't tell" into a falsy/zero result there
 * would read as "safe to delete" and destroy master data. This function guards a read: an
 * ingest event or DTO builder seeing an unparseable legacy coinType should degrade to
 * "unknown scale," not crash the pipeline. Do not unify these two behaviors — the read path
 * and the destructive-op gate have opposite failure-safety requirements by design.
 */
export function getAssetDecimals(db: Db, entityId: string, coinType: string): AssetInfo | null {
  let canonical: string;
  try { canonical = canonicalCoinType(coinType); } catch { return null; }
  const row = getAsset(db, entityId, canonical);
  if (row === null) return null;
  return { decimals: row.decimals, symbol: row.symbol, displayName: row.displayName, source: row.source };
}
