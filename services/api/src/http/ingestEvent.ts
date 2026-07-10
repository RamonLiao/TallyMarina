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
 * Defect A gate. It guards BOTH legs of an event, because any per-event decimals field that
 * reaches mulUnitPrice -> cost basis -> JE -> leaf -> merkle root -> chain is a fail-open hole
 * if left unchecked, not just the sold leg's `assetDecimals`:
 *   - sold leg:          `coinType`           + `assetDecimals`
 *   - consideration leg: `considerationAsset` + `considerationDecimals`  (the buy leg of a swap)
 * The consideration leg is the more dangerous one: `considerationDecimals` divides the swap's
 * fair value in p06_pricefx, so an unvalidated scale silently rescales cost basis by 10^n and
 * anchors it. Both legs run through the SAME check (checkAssetLeg) so the two can never drift.
 *
 * The registry VALIDATES the claim — it does not replace the value, so rules-engine, JE
 * encoding, leaf hashes, merkle roots and every previously anchored snapshot stay
 * byte-identical. All this adds is a door.
 *
 * getAssetDecimals is a synchronous, no-network read (safe on the hot path) and internally
 * canonicalizes; an invalid coinType reads as null -> *_NOT_REGISTERED, which is correct
 * (an event whose coinType string is unparseable must not post).
 */
interface LegLabels {
  notRegistered: string;
  decimalsMismatch: string;
  decimalsWithoutCoin: string;
}

const SOLD_LEG_LABELS: LegLabels = {
  notRegistered: 'ASSET_NOT_REGISTERED',
  decimalsMismatch: 'ASSET_DECIMALS_MISMATCH',
  decimalsWithoutCoin: 'ASSET_DECIMALS_WITHOUT_COIN_TYPE',
};

const CONSIDERATION_LEG_LABELS: LegLabels = {
  notRegistered: 'CONSIDERATION_ASSET_NOT_REGISTERED',
  decimalsMismatch: 'CONSIDERATION_DECIMALS_MISMATCH',
  decimalsWithoutCoin: 'CONSIDERATION_DECIMALS_WITHOUT_COIN_TYPE',
};

/**
 * One leg's registry check. `null` and `undefined` both mean "this leg is absent": a non-swap
 * event carries considerationAsset/considerationDecimals as explicit nulls, and those must pass
 * through untouched. A decimals value present without its coinType is structurally incoherent.
 */
function checkAssetLeg(db: Db, entityId: string, coinType: unknown, decimals: unknown, labels: LegLabels): void {
  if (typeof coinType !== 'string') {
    if (decimals !== undefined && decimals !== null) {
      throw new AssetGateError(labels.decimalsWithoutCoin, 'decimals present with no coinType');
    }
    return; // fiat / gas events, or a swap's absent buy leg, carry no asset scale
  }

  const info = getAssetDecimals(db, entityId, coinType);
  if (info === null) {
    throw new AssetGateError(labels.notRegistered, `${coinType} is not registered for ${entityId}`);
  }
  if (decimals !== info.decimals) {
    throw new AssetGateError(labels.decimalsMismatch,
      `${coinType}: event says ${String(decimals)}, registry says ${info.decimals}`);
  }
}

function assetGate(db: Db, entityId: string, parsed: Record<string, unknown>): void {
  checkAssetLeg(db, entityId, parsed.coinType, parsed.assetDecimals, SOLD_LEG_LABELS);
  checkAssetLeg(db, entityId, parsed.considerationAsset, parsed.considerationDecimals, CONSIDERATION_LEG_LABELS);
}

/**
 * Atomic ingest gate: derive period, refuse+log if LOCKED, else insert (spec §5.2).
 *
 * `id` exists ONLY so the demo seeder can preserve the fixture's deterministic event ids
 * (evt-001, …) while still passing through THIS gate rather than around it. Every other
 * caller must let the gate mint one. A caller-supplied id that collides violates
 * events.id's PRIMARY KEY and throws — that is the intended behaviour, not a bug to smooth over.
 */
export function ingestEvent(db: Db, entityId: string, rawJson: string, id?: string): { eventId: string; periodId: string } {
  const periodId = deriveEventPeriod(rawJson); // throws INVALID_EVENT_TIME
  const parsed = JSON.parse(rawJson) as { eventTime: string } & Record<string, unknown>;
  const eventTime = parsed.eventTime;
  const eventId = id ?? `evt-${randomUUID()}`;

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
