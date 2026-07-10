import type { Db } from '../store/db.js';
import { randomUUID } from 'node:crypto';
import { deriveEventPeriod, insertEvent } from '../store/eventStore.js';
import { appendRejectedEvent } from '../store/rejectedEventLog.js';
import { getPeriodLock } from '../periodLock/store.js';
import { getAssetDecimals } from '../assets/registry.js';

export class PeriodLockedError extends Error {
  constructor(public periodId: string, public eventTime: string) {
    super(`PERIOD_LOCKED_FOR_DATE: ${periodId}`);
    this.name = 'PeriodLockedError';
  }
}

export class AssetGateError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(`${reason}: ${message}`);
    this.name = 'AssetGateError';
  }
}

/**
 * Defect A gate. event.assetDecimals is a per-event field that feeds mulUnitPrice -> cost
 * basis -> JE -> leaf -> merkle root -> chain; two events for one coinType could carry
 * different scales with no invariant to stop them. The registry VALIDATES the claim — it
 * does not replace the value, so rules-engine, JE encoding, leaf hashes, merkle roots and
 * every previously anchored snapshot stay byte-identical. All this adds is a door.
 *
 * getAssetDecimals is a synchronous, no-network read (safe on the hot path) and internally
 * canonicalizes; an invalid coinType reads as null -> ASSET_NOT_REGISTERED, which is correct
 * (an event whose coinType string is unparseable must not post).
 */
function assetGate(db: Db, entityId: string, parsed: Record<string, unknown>): void {
  const coinType = parsed.coinType;
  const assetDecimals = parsed.assetDecimals;

  if (typeof coinType !== 'string') {
    if (assetDecimals !== undefined) {
      throw new AssetGateError('ASSET_DECIMALS_WITHOUT_COIN_TYPE', 'assetDecimals present with no coinType');
    }
    return; // fiat / gas events carry no asset scale
  }

  const info = getAssetDecimals(db, entityId, coinType);
  if (info === null) {
    throw new AssetGateError('ASSET_NOT_REGISTERED', `${coinType} is not registered for ${entityId}`);
  }
  if (assetDecimals !== info.decimals) {
    throw new AssetGateError('ASSET_DECIMALS_MISMATCH',
      `${coinType}: event says ${String(assetDecimals)}, registry says ${info.decimals}`);
  }
}

/** Atomic ingest gate: derive period, refuse+log if LOCKED, else insert (spec §5.2). */
export function ingestEvent(db: Db, entityId: string, rawJson: string): { eventId: string; periodId: string } {
  const periodId = deriveEventPeriod(rawJson); // throws INVALID_EVENT_TIME
  const parsed = JSON.parse(rawJson) as { eventTime: string } & Record<string, unknown>;
  const eventTime = parsed.eventTime;
  const eventId = `evt-${randomUUID()}`;

  // Registry gate runs BEFORE the period-lock transaction. It is a pure read, so logging the
  // rejection outside any transaction cannot be rolled back (same reasoning as the lock path).
  try {
    assetGate(db, entityId, parsed);
  } catch (err) {
    if (err instanceof AssetGateError) {
      appendRejectedEvent(db, { entityId, periodId, eventTime, rawJson, reason: err.reason });
    }
    throw err;
  }

  // Throwing inside a better-sqlite3 transaction rolls back everything written in it,
  // including a reject-log insert (TOCTOU trap: log would vanish along with the aborted
  // insert). So the transaction only ever does the success-path check+insert — it never
  // throws — and the reject-log append + throw happen AFTER it commits, off the txn.
  let rejected = false;
  db.transaction(() => {
    if (getPeriodLock(db, entityId, periodId).status === 'LOCKED') {
      rejected = true;
      return;
    }
    insertEvent(db, { id: eventId, entityId, rawJson });
  })();

  if (rejected) {
    appendRejectedEvent(db, { entityId, periodId, eventTime, rawJson, reason: 'PERIOD_LOCKED_FOR_DATE' });
    throw new PeriodLockedError(periodId, eventTime);
  }
  return { eventId, periodId };
}
