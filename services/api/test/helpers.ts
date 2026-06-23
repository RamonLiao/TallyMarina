/**
 * Shared test helpers for route tests.
 * Extends the buildTestApp factory with seed helpers for snapshots and anchors.
 */
export { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { insertEntity, type EntityRow } from '../src/store/entityStore.js';
import { insertSnapshot, type SnapshotRow } from '../src/store/snapshotStore.js';
import { insertAnchor, type AnchorRow } from '../src/store/anchorStore.js';
import type { Db } from '../src/store/db.js';

/**
 * Seed an entity with minimal required fields.
 */
export function seedEntity(
  db: Db,
  id: string,
  overrides?: Partial<EntityRow>,
): void {
  insertEntity(db, {
    id,
    displayName: overrides?.displayName ?? `display-${id}`,
    chainObjectId: overrides?.chainObjectId ?? '0xchain',
    capObjectId: overrides?.capObjectId ?? '0xcap',
    originalPackageId: overrides?.originalPackageId ?? '0xpkg',
  });
}

/**
 * Seed a snapshot with sensible defaults.
 * manifestJson defaults to '{}', manifestHash to 'h', leafCount to 1, supersedesSeq to null, status to 'ANCHORED'.
 */
export function seedSnapshot(
  db: Db,
  overrides: Partial<Omit<SnapshotRow, 'status'> & { status?: string }>,
): void {
  const id = overrides.id ?? 'snap-default';
  const entityId = overrides.entityId ?? 'acme:pilot-001';
  const periodId = overrides.periodId ?? 'period-1';
  const manifestJson = overrides.manifestJson ?? '{}';
  const manifestHash = overrides.manifestHash ?? 'h';
  const merkleRoot = overrides.merkleRoot ?? 'root-default';
  const leafCount = overrides.leafCount ?? 1;
  const supersedesSeq = overrides.supersedesSeq ?? null;
  const status = overrides.status ?? 'ANCHORED';

  insertSnapshot(db, {
    id,
    entityId,
    periodId,
    manifestJson,
    manifestHash,
    merkleRoot,
    leafCount,
    supersedesSeq,
    status: status as any,
  });
}

/**
 * Seed an anchor with sensible defaults.
 * link defaults to 'L', digest to 'D', explorerUrl to '#', anchoredAt to '2026-06-23T00:00:00Z'.
 */
export function seedAnchor(
  db: Db,
  overrides: Partial<AnchorRow>,
): void {
  const id = overrides.id ?? 'anc-default';
  const entityId = overrides.entityId ?? 'acme:pilot-001';
  const snapshotId = overrides.snapshotId ?? 'snap-default';
  const seq = overrides.seq ?? 1;
  const link = overrides.link ?? 'L';
  const digest = overrides.digest ?? 'D';
  const explorerUrl = overrides.explorerUrl ?? '#';
  const anchoredAt = overrides.anchoredAt ?? '2026-06-23T00:00:00Z';

  insertAnchor(db, {
    id,
    entityId,
    snapshotId,
    seq,
    link,
    digest,
    explorerUrl,
    anchoredAt,
  });
}
