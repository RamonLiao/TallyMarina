import type { Db } from '../store/db.js';
import { randomUUID } from 'node:crypto';
import { deriveEventPeriod, insertEvent } from '../store/eventStore.js';
import { appendRejectedEvent } from '../store/rejectedEventLog.js';
import { getPeriodLock } from '../periodLock/store.js';

export class PeriodLockedError extends Error {
  constructor(public periodId: string, public eventTime: string) {
    super(`PERIOD_LOCKED_FOR_DATE: ${periodId}`);
    this.name = 'PeriodLockedError';
  }
}

/** Atomic ingest gate: derive period, refuse+log if LOCKED, else insert (spec §5.2). */
export function ingestEvent(db: Db, entityId: string, rawJson: string): { eventId: string; periodId: string } {
  const periodId = deriveEventPeriod(rawJson); // throws INVALID_EVENT_TIME
  const eventTime = (JSON.parse(rawJson) as { eventTime: string }).eventTime;
  const eventId = `evt-${randomUUID()}`;

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
