import { insertAssetIfAbsent } from '../../src/assets/store.js';
import { canonicalCoinType } from '../../src/assets/normalize.js';
import type { Db } from '../../src/store/db.js';

/**
 * Register an asset so ingest's registry gate lets a fixture event through.
 *
 * This restores a precondition the pre-registry system never had: an event carrying a
 * coinType must have a registered scale. It does NOT weaken the gate — it supplies the
 * master-data row the gate checks against.
 */
export function registerTestAsset(db: Db, entityId: string, coinType: string, decimals: number): void {
  insertAssetIfAbsent(db, {
    entityId, coinType: canonicalCoinType(coinType), decimals,
    symbol: coinType.split('::').pop() ?? coinType, displayName: coinType,
    source: 'chain', chainObjectId: '0xtest', metadataCapState: 'DELETED',
    fetchedAt: '2026-01-01T00:00:00Z', decidedBy: null, reason: null,
    createdAt: '2026-01-01T00:00:00Z',
  });
}
