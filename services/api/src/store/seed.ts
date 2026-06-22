import type { Db } from './db.js';
import { getEntity, insertEntity } from './entityStore.js';
import { insertEvent } from './eventStore.js';
import { normalizeFixture, type FixtureBundle } from '../deps/ingestion.js';

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
  const events = normalizeFixture(fixture);
  for (const ev of events) {
    insertEvent(db, { id: ev.eventId, entityId: cfg.entityId, rawJson: JSON.stringify(ev) });
  }
}
