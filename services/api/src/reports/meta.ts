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
import { computeJeGreen, computeCompletenessGreen } from '../periodLock/cockpit.js';

export interface ReportMeta {
  accountingStandard: string;
  policySetVersion: string;
  periodStatus: string;
  generatedAt: string;
}

// Fix 2 (dual-review external round): drift is now MULTI-DIMENSIONAL. The frozen lights_snapshot
// pins BOTH the 'je' and 'completeness' evidence a controller signed off on; a post-lock raw edit
// can break either independently (e.g. a raw lot_valuation INSERT breaks the roll-forward's
// per-coin GL tie → completeness only, while the je tie-out still holds). Each drifting light
// contributes one dimension; a null drift means every checked dimension still agrees.
export type DriftLight = 'je' | 'completeness';
export interface DriftDimension {
  light: DriftLight;
  frozenStatus: string;
  recomputedGreen: boolean;
}
export interface LockedDrift {
  code: 'LIGHTS_SNAPSHOT_DRIFT';
  dimensions: DriftDimension[];
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
// Final review I-1 / Fix 2: each dimension's recomputedGreen MUST use the SAME predicate the
// cockpit uses to decide the frozen snapshot's status — computeJeGreen (per-JE sweep AND TB
// tie-out) for 'je', computeCompletenessGreen (roll-forward identities, N/A→green) for
// 'completeness'. A period can only ever drift against what actually made a light green at lock
// time, never a narrower re-derivation.
const DRIFT_CHECKS: Array<{ light: DriftLight; recompute: (db: Db, e: string, p: string) => boolean }> = [
  { light: 'je', recompute: computeJeGreen },
  { light: 'completeness', recompute: computeCompletenessGreen },
];

export function lockedDrift(db: Db, entityId: string, periodId: string): LockedDrift | null {
  const lock = getPeriodLock(db, entityId, periodId);
  // periodLock/state.ts's PeriodStatus is currently 'OPEN' | 'LOCKED' only (no separate FROZEN
  // state exists yet in this codebase) — drift only matters once a period is locked at all.
  if (lock.status !== 'LOCKED') return null;
  if (!lock.lightsSnapshot) return null;
  const lights = JSON.parse(lock.lightsSnapshot) as Array<{ key: string; status: string }>;
  const dimensions: DriftDimension[] = [];
  for (const { light, recompute } of DRIFT_CHECKS) {
    const frozen = lights.find((l) => l.key === light);
    if (!frozen) continue; // light not in the frozen snapshot — nothing to compare against
    const recomputedGreen = recompute(db, entityId, periodId);
    if ((frozen.status === 'green') !== recomputedGreen) {
      dimensions.push({ light, frozenStatus: frozen.status, recomputedGreen });
    }
  }
  if (dimensions.length === 0) return null;
  return { code: 'LIGHTS_SNAPSHOT_DRIFT', dimensions };
}
