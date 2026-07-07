// services/api/test/helpers/journal.ts
// Thin helper: insert a valid journal_entries row for (entityId, periodId) and return the
// buildMerkle root of the current period journal (post-insert), so tests match reality.
import type { Db } from '../../src/store/db.js';
import { insertJournalEntry, listJournal } from '../../src/store/journalStore.js';
import { insertEvent } from '../../src/store/eventStore.js';
import { buildMerkle, type JournalEntry } from '../../src/deps/rulesEngine.js';

let counter = 0;

// Maps a 'YYYY-Qn' periodId to an eventTime ISO string inside that quarter, so that
// insertEvent's derived period_id matches the periodId the caller asked for.
function eventTimeFor(periodId: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(periodId);
  if (!m) throw new Error(`insertJournalRow: unsupported periodId format ${periodId}`);
  const year = m[1];
  const month = String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0');
  return `${year}-${month}-15T00:00:00Z`;
}

export function insertJournalRow(
  db: Db,
  entityId: string,
  periodId: string,
  opts?: { amount?: string },
): { root: string } {
  counter += 1;
  const amount = opts?.amount ?? '100';
  const eventId = `evt-${entityId}-${periodId}-${counter}`;
  insertEvent(db, { id: eventId, entityId, rawJson: JSON.stringify({ eventTime: eventTimeFor(periodId) }) });
  const lines = [
    { account: '1000', side: 'DEBIT' as const, amountMinor: amount, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    { account: '4000', side: 'CREDIT' as const, amountMinor: amount, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
  ];
  const jeJson = JSON.stringify({ idempotencyKey: eventId, lineageHash: 'h', reversalOf: null, lines });
  insertJournalEntry(db, {
    id: `je-${eventId}`,
    entityId,
    eventId,
    jeJson,
    idempotencyKey: eventId,
    leafHash: `leaf-${eventId}`,
    periodId,
  });
  const jes = listJournal(db, entityId, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
  const { manifest } = buildMerkle(jes);
  return { root: manifest.merkleRoot };
}
