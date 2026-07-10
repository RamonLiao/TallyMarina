import type { Db } from './db.js';
import { getEntity, insertEntity } from './entityStore.js';
import { insertAssetIfAbsent } from '../assets/store.js';
import { canonicalCoinType } from '../assets/normalize.js';
import { ingestEvent } from '../http/ingestEvent.js';
import { normalizeFixture, type FixtureBundle } from '../deps/ingestion.js';
import { DEMO_ASSETS } from '../fixtures/demoAssets.js';

export function seed(
  db: Db,
  cfg: { entityId: string; entityChainId: string; entityCapId: string; originalPackageId: string },
  fixture: FixtureBundle,
): void {
  if (getEntity(db, cfg.entityId)) return; // idempotent
  insertEntity(db, {
    id: cfg.entityId, displayName: 'Acme Pilot 001',
    chainObjectId: cfg.entityChainId, capObjectId: cfg.entityCapId, originalPackageId: cfg.originalPackageId,
  });

  // Master data FIRST — declared, not inferred from the events below (D1). The seeder runs
  // offline (no chain fetcher), so every asset is registered source='manual': it cannot claim
  // 'chain' provenance it never verified, not even for 0x2::sui::SUI. The live `seed:assets`
  // script is the path that promotes SUI to source='chain'.
  const now = new Date().toISOString();
  for (const a of DEMO_ASSETS) {
    insertAssetIfAbsent(db, {
      entityId: cfg.entityId, coinType: canonicalCoinType(a.coinType), decimals: a.decimals,
      symbol: a.symbol, displayName: a.symbol, source: 'manual',
      chainObjectId: null, metadataCapState: null, fetchedAt: null,
      decidedBy: 'seed', reason: a.reason, createdAt: now,
    });
  }

  // Events go through the SAME gate every other ingest uses — never the raw event writer.
  // A fixture event whose assetDecimals contradicts a registered value fails LOUDLY here; that
  // is the point (it would mean the demo fixture is internally inconsistent). The fixture's
  // deterministic eventId is preserved through the gate's optional id parameter.
  const events = normalizeFixture(fixture);
  for (const ev of events) {
    ingestEvent(db, cfg.entityId, JSON.stringify(ev), ev.eventId);
  }
}
