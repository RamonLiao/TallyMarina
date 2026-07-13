// Task 6: audit meta for read-only report endpoints (trial-balance / roll-forward), plus
// LOCKED-period drift detection against the frozen cockpit lights_snapshot (spec ruling 4).
//
// Why this exists as its own module rather than inline in routes.ts: the drift check parses
// a JSON blob written by a DIFFERENT subsystem (periodLock/cockpit.ts's Light[] snapshot) —
// keeping the parsing/comparison logic here, with its own types, means a future change to the
// snapshot shape only needs updating in one place, not wherever a report route happens to call it.
import type { Db } from '../store/db.js';
import { getActivePolicy } from '../store/policyStore.js';
import { getPeriodLock } from '../periodLock/store.js';
import { computeJeGreen } from '../periodLock/cockpit.js';

export interface ReportMeta {
  accountingStandard: string;
  policySetVersion: string;
  periodStatus: string;
  generatedAt: string;
}

export interface LockedDrift {
  code: 'LIGHTS_SNAPSHOT_DRIFT';
  frozenJeStatus: string;
  recomputedBalanced: boolean;
}

export function buildReportMeta(db: Db, entityId: string, periodId: string): ReportMeta {
  const { doc } = getActivePolicy(db, entityId);
  const lock = getPeriodLock(db, entityId, periodId);
  return {
    accountingStandard: doc.accountingStandard,
    policySetVersion: doc.policySetVersion,
    periodStatus: lock.status,
    generatedAt: new Date().toISOString(),
  };
}

// Spec ruling 4 (fail-loud): once a period is LOCKED/FROZEN, its cockpit lights_snapshot is the
// frozen evidence a controller signed off on. If the current *recomputed* 'je' light disagrees
// with the frozen snapshot's 'je' status, the ledger changed after the sign-off (e.g. a raw
// INSERT/UPDATE into journal_entries post-lock) — that must surface as a fail-loud drift object,
// never silently re-derive a "new truth" that contradicts the frozen one.
//
// Final review I-1: recomputedGreen MUST use computeJeGreen — the exact same per-JE-sweep AND
// tie-out predicate jeLight uses to decide the frozen snapshot's 'je' status in the first place.
// Re-checking only tieOut.balanced (the pre-fix behavior) misses drift where an aggregate-
// preserving raw edit breaks a single JE's own debit/credit balance while leaving ΣDr=ΣCr and
// Σsigned-closing=0 intact — that case would silently report drift=null.
export function lockedDrift(db: Db, entityId: string, periodId: string): LockedDrift | null {
  const lock = getPeriodLock(db, entityId, periodId);
  // periodLock/state.ts's PeriodStatus is currently 'OPEN' | 'LOCKED' only (no separate FROZEN
  // state exists yet in this codebase) — drift only matters once a period is locked at all.
  if (lock.status !== 'LOCKED') return null;
  if (!lock.lightsSnapshot) return null;
  const lights = JSON.parse(lock.lightsSnapshot) as Array<{ key: string; status: string }>;
  const je = lights.find((l) => l.key === 'je');
  if (!je) return null;
  const frozenGreen = je.status === 'green';
  const recomputedGreen = computeJeGreen(db, entityId, periodId);
  if (frozenGreen === recomputedGreen) return null;
  return { code: 'LIGHTS_SNAPSHOT_DRIFT', frozenJeStatus: je.status, recomputedBalanced: recomputedGreen };
}
