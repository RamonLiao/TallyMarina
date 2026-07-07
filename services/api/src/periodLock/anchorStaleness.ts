// services/api/src/periodLock/anchorStaleness.ts
import type { Db } from '../store/db.js';
import { listSnapshotsForPeriod, getLatestSnapshotSeq } from '../store/snapshotStore.js';
import { buildMerkle, type JournalEntry } from '../deps/rulesEngine.js';
import { listJournal } from '../store/journalStore.js';

export interface AnchorStaleness {
  stale: boolean; anchoredSeq: number; anchoredRoot: string;
  currentRoot: string | null; latestSnapshotSeq: number;
}

/**
 * STALE_ANCHOR: the on-chain anchor no longer matches the current books.
 * Deterministic — recompute the current period root and compare to the latest
 * ANCHORED snapshot's root. Replaces the coarse cockpit proxy (which went dark
 * after re-lock even while the anchor was still stale). Empty journal ⇒ stale
 * (root can't match; must not throw EMPTY_SNAPSHOT). Returns null if never anchored.
 */
export function deriveAnchorStaleness(db: Db, entityId: string, periodId: string): AnchorStaleness | null {
  const anchored = listSnapshotsForPeriod(db, entityId, periodId)
    .filter((s) => s.status === 'ANCHORED')
    .sort((a, b) => b.seq - a.seq)[0];
  if (!anchored) return null;

  const jes = listJournal(db, entityId, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
  let currentRoot: string | null;
  if (jes.length === 0) {
    currentRoot = null; // empty period: root undefined → definitely not equal
  } else {
    currentRoot = buildMerkle(jes).manifest.merkleRoot;
  }
  return {
    stale: currentRoot !== anchored.merkleRoot,
    anchoredSeq: anchored.seq,
    anchoredRoot: anchored.merkleRoot,
    currentRoot,
    latestSnapshotSeq: getLatestSnapshotSeq(db, entityId, periodId),
  };
}
