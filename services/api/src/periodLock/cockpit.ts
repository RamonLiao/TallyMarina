import type { Db } from '../store/db.js';
import type { PeriodStatus } from './state.js';
import { getPeriodLock } from './store.js';
import { hasAnchoredSnapshotForPeriod } from '../store/snapshotStore.js';
import { listJournal } from '../store/journalStore.js';
import { deriveAnchorStaleness, type AnchorStaleness } from './anchorStaleness.js';
import { collectExceptions } from '../exceptions/collect.js';
import { getDisposition } from '../store/dispositionStore.js';
import { blocksClose } from '../exceptions/disposition.js';
import { BLOCKING_CATEGORIES } from '../exceptions/types.js';
import { openMaterialReconBlockers } from '../reconciliation/collect.js';
import { listByStatus, listEvents } from '../store/eventStore.js';

export type LightStatus = 'green' | 'red' | 'mock';
export interface Light { key: string; status: LightStatus; label: string; real: boolean }
export interface CockpitView {
  lights: Light[]; status: PeriodStatus; anchored: boolean; staleAnchor: boolean;
  anchorStaleness: AnchorStaleness | null;
  closeable: boolean; reopenCount: number; restatementReason: string | null; reasonCode: string | null;
}

interface JeLine { side: 'DEBIT' | 'CREDIT'; amountMinor: string }
interface Je { lines: JeLine[] }

function classificationLight(db: Db, entityId: string, periodId: string, lowConf: number): Light {
  const pending = listByStatus(db, entityId, 'NEEDS_REVIEW').length;
  const blocking = collectExceptions(db, entityId, periodId, lowConf)
    .filter((e) => BLOCKING_CATEGORIES.includes(e.category))
    .filter((e) => blocksClose(getDisposition(db, e.category, e.eventId))).length;
  const green = pending === 0 && blocking === 0;
  return { key: 'classification', status: green ? 'green' : 'red', label: 'Classification', real: true };
}

// NOTE: jeLight and completenessLight are ENTITY-scoped, not period-scoped, because
// events/JEs carry no period_id (spec §9 "Period attribution / Cutoff control" — blocking-for-production).
// This is intentional and consistent with the entity-scoped /snapshot, exceptions, and recon gates.
function jeLight(db: Db, entityId: string): Light {
  const jes = listJournal(db, entityId);
  if (jes.length === 0) return { key: 'je', status: 'red', label: 'Journal entries (TB tie-out)', real: true };
  let tbDebit = 0n, tbCredit = 0n, perJeOk = true;
  for (const r of jes) {
    const je = JSON.parse(r.jeJson) as Je;
    let d = 0n, c = 0n;
    for (const l of je.lines) {
      const amt = BigInt(l.amountMinor);
      if (l.side === 'DEBIT') { d += amt; tbDebit += amt; } else { c += amt; tbCredit += amt; }
    }
    if (d !== c) perJeOk = false;
  }
  const green = perJeOk && tbDebit === tbCredit;
  return { key: 'je', status: green ? 'green' : 'red', label: 'Journal entries (TB tie-out)', real: true };
}

function reconLight(db: Db, entityId: string, periodId: string): Light {
  try {
    const blocking = openMaterialReconBlockers(db, entityId, periodId).length;
    return { key: 'recon', status: blocking === 0 ? 'green' : 'red', label: 'Reconciliation', real: true };
  } catch {
    // Cannot verify reconciliation (e.g. wallet-less event) → fail-closed: red blocks close.
    return { key: 'recon', status: 'red', label: 'Reconciliation', real: true };
  }
}

function completenessLight(db: Db, entityId: string): Light {
  const events = listEvents(db, entityId);
  // Events start at INGESTED; processed events move to AUTO or NEEDS_REVIEW.
  // "Stuck at INGESTED" = not yet processed by AI classify step.
  const stuckIngested = listByStatus(db, entityId, 'INGESTED').length;
  const ok = events.length > 0 && stuckIngested === 0;
  return { key: 'completeness', status: ok ? 'green' : 'red', label: 'Ingest presence (no cutoff assurance)', real: false };
}

const MOCK = (key: string, label: string): Light => ({ key, status: 'mock', label, real: false });

export function buildCockpit(db: Db, entityId: string, periodId: string, lowConf: number): CockpitView {
  const lights: Light[] = [
    classificationLight(db, entityId, periodId, lowConf),
    jeLight(db, entityId),
    reconLight(db, entityId, periodId),
    completenessLight(db, entityId),
    MOCK('pricing', 'Pricing coverage'),
    MOCK('export', 'ERP export'),
  ];
  const lock = getPeriodLock(db, entityId, periodId);
  const anchored = hasAnchoredSnapshotForPeriod(db, entityId, periodId);
  // staleAnchor: deterministic STALE_ANCHOR derivation (root-compare) — recompute the current
  //   period's merkle root and compare to the latest ANCHORED snapshot's root. Replaces a
  //   coarse reopen-count proxy, which went dark after re-lock even while the anchor was still
  //   stale (Rule 7: one source of truth).
  const anchorStaleness = deriveAnchorStaleness(db, entityId, periodId);
  const staleAnchor = anchorStaleness?.stale ?? false;
  const closeable = lights.filter((l) => l.status !== 'mock').every((l) => l.status === 'green');
  return {
    lights, status: lock.status, anchored, staleAnchor, anchorStaleness, closeable,
    reopenCount: lock.reopenCount, restatementReason: lock.restatementReason, reasonCode: lock.reasonCode,
  };
}
