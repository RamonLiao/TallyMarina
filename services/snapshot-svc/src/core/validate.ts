import { SnapshotMeta, SnapshotError } from '../domain/types.js';

function assertUtf8(s: string, label: string): void {
  const roundTrip = Buffer.from(s, 'utf8').toString('utf8');
  if (roundTrip !== s) {
    throw new SnapshotError('INVALID_ENCODING', `${label} is not valid UTF-8`);
  }
}

export function assertPolicyVersionsUtf8(policyVersions: string[]): void {
  for (const v of policyVersions) {
    assertUtf8(v, `policyVersions entry "${v}"`);
  }
}

export function validateMeta(meta: SnapshotMeta): void {
  if (typeof meta.entityId !== 'string' || meta.entityId.length === 0) {
    throw new SnapshotError('INVALID_META', 'entityId must be non-empty string');
  }
  if (!Number.isSafeInteger(meta.createdAtLogical) || meta.createdAtLogical < 0) {
    throw new SnapshotError('INVALID_META', 'createdAtLogical must be a non-negative safe integer');
  }
  assertUtf8(meta.entityId, 'entityId');
  if (typeof meta.periodId !== 'string') {
    throw new SnapshotError('INVALID_META', 'periodId must be string');
  }
  assertUtf8(meta.periodId, 'periodId');
  if (Buffer.byteLength(meta.periodId, 'utf8') > 64) {
    throw new SnapshotError('PERIOD_ID_TOO_LONG', 'periodId exceeds 64 UTF-8 bytes');
  }
}
