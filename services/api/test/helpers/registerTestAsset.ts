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

/**
 * The four assets acme:pilot-001's recon fixture references, with their real decimals.
 * (NOT five — 0xface::tok::TOK belongs to opening-lot-recon-test:entity.)
 *
 * Registering these is the master-data precondition the registry close-gate checks. Tests that
 * exercise lock/snapshot/cockpit for acme now must supply it — the gate is new, so the fixture's
 * assets are unregistered until a test provides this row set. This SUPPLIES the precondition; it
 * does not weaken the gate (which still blocks whenever any held asset has no registered scale).
 */
export const ACME_FIXTURE_ASSETS: ReadonlyArray<readonly [string, number]> = [
  ['0x2::sui::SUI', 9], ['0xbeef::usdc::USDC', 6],
  ['0xcafe::weth::WETH', 8], ['0xdead::usdt::USDT', 6],
];

export function registerAcmeFixtureAssets(db: Db, entityId = 'acme:pilot-001'): void {
  for (const [ct, dp] of ACME_FIXTURE_ASSETS) registerTestAsset(db, entityId, ct, dp);
}
