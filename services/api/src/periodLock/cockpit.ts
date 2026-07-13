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
import { openMaterialReconBlockers, unregisteredAssetBlockers } from '../reconciliation/collect.js';
import { listByStatus } from '../store/eventStore.js';
import { loadRevaluationContext } from '../revaluation/orchestrate.js';
import { buildTrialBalance } from '../reports/trialBalance.js';
import { buildRollForward } from '../reports/rollForward.js';

export type LightStatus = 'green' | 'red' | 'stale' | 'mock';
export interface Light { key: string; status: LightStatus; label: string; real: boolean; note?: string }
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

// NOTE: completenessLight stays ENTITY-scoped (spec §9 "Period attribution / Cutoff control"
// — blocking-for-production). jeLight's per-JE balance sweep is still entity-scoped, but the
// aggregate tie-out is now the full buildTrialBalance as-of periodId (Task 4, spec §14 step 5):
// it also fails closed on unknown-class accounts and Σsigned-closing ≠ 0, which the old
// raw ΣDr=ΣCr sum could never see.
// Single source of truth (Rule 7) for the 'je' light's green/red predicate: per-JE balance sweep
// AND TB tie-out must both hold. Exported so meta.ts's lockedDrift (LOCKED-period fail-loud
// re-check, spec ruling 4) recomputes against the EXACT same semantics jeLight uses — a period
// can only ever drift against what actually made 'je' green at lock time, never a narrower
// re-derivation (final review I-1: the old lockedDrift only re-checked tieOut.balanced, missing
// the per-JE dimension entirely).
export function computeJeGreen(db: Db, entityId: string, periodId: string): boolean {
  const jes = listJournal(db, entityId);
  if (jes.length === 0) return false;
  let perJeOk = true;               // §14 step 5: per-JE balance AND TB tie-out must both hold
  for (const r of jes) {
    const je = JSON.parse(r.jeJson) as Je;
    let d = 0n, c = 0n;
    for (const l of je.lines) {
      const amt = BigInt(l.amountMinor);
      if (l.side === 'DEBIT') d += amt; else c += amt;
    }
    if (d !== c) perJeOk = false;
  }
  // Fail-closed like recon/registry/revaluation lights. Unparseable JE period_id (column is
  // nullable — legacy rows) no longer throws: buildTrialBalance records it in tieOut.failures
  // and returns balanced=false → red via the normal path. The catch below now only guards
  // corrupt-money throws (malformed amountMinor inside buildTrialBalance). The per-JE loop
  // above still does a bare BigInt() first and would throw out of buildCockpit (500), same as
  // the pre-Task-4 jeLight. Widening that guard is a tracked follow-up.
  let tieOutOk = false;
  try {
    tieOutOk = buildTrialBalance(db, entityId, periodId).tieOut.balanced;
  } catch {
    tieOutOk = false;
  }
  return perJeOk && tieOutOk;
}

function jeLight(db: Db, entityId: string, periodId: string): Light {
  const green = computeJeGreen(db, entityId, periodId);
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

// Registry light (call site 5): red while we hold any asset whose scale we do not know.
// key MUST be 'registry' — the frontend's dispatchTarget() routes on it. Orthogonal to the recon
// light: a period with zero material breaks can still be red here, because "no material break" is
// itself a claim computed against a scale an unregistered asset does not have.
function registryLight(db: Db, entityId: string, periodId: string): Light {
  try {
    const blocking = unregisteredAssetBlockers(db, entityId, periodId).length;
    return { key: 'registry', status: blocking === 0 ? 'green' : 'red', label: 'Asset registry', real: true };
  } catch {
    // Same collectBreaks path reconLight guards: a wallet-less event throws. Fail-closed → red.
    return { key: 'registry', status: 'red', label: 'Asset registry', real: true };
  }
}

// Completeness light (Task 5, spec §14 step 6, ruling 6): real化 — consumes buildRollForward's
// ASU 2023-08 roll-forward identities instead of the old "any events ingested, none stuck"
// presence-only mock. This is a BLOCKING gate change: a GAAP FV-basis period whose roll-forward
// doesn't tie (identity① per-asset or identity② vs. the TB DigitalAssets ledger) now reds and
// blocks /period/lock, where the old mock would have shown green.
//   - IFRS (or any entity where the roll-forward is notApplicable) → green, real:true, PLUS a
//     `note` explaining why (ruling 6: N/A must be auditable, not a silent/indistinguishable
//     green — an auditor must be able to tell "checked, doesn't apply" from "not checked").
//   - US_GAAP → identitiesOk drives green/red.
// Fail-closed like recon/registry/revaluation/je: buildRollForward can throw (malformed
// periodId — periodCutoff throws, same convention Task 4 established for jeLight) → red, never
// a 500 out of the whole cockpit.
// Single source of truth (Rule 7) for the 'completeness' light's green/red predicate, mirroring
// computeJeGreen: notApplicable (IFRS / no ASU track) → green (N/A is still "checked"), else
// identitiesOk drives it; fail-closed (buildRollForward throws on a malformed periodId) → red.
// Exported so meta.ts's lockedDrift re-checks completeness against the EXACT predicate that made
// the frozen snapshot green — a period can only ever drift against what actually locked green.
export function computeCompletenessGreen(db: Db, entityId: string, periodId: string): boolean {
  try {
    const rf = buildRollForward(db, entityId, periodId);
    return rf.notApplicable ? true : rf.identitiesOk;
  } catch {
    return false;
  }
}

const COMPLETENESS_LABEL = 'Completeness (ASU 2023-08 roll-forward)';

function completenessLight(db: Db, entityId: string, periodId: string): Light {
  try {
    const rf = buildRollForward(db, entityId, periodId);
    if (rf.notApplicable) {
      return {
        key: 'completeness', status: 'green', label: COMPLETENESS_LABEL, real: true,
        note: 'N/A — ASU 2023-08 roll-forward does not apply under IFRS',
      };
    }
    return { key: 'completeness', status: rf.identitiesOk ? 'green' : 'red', label: COMPLETENESS_LABEL, real: true };
  } catch {
    return { key: 'completeness', status: 'red', label: COMPLETENESS_LABEL, real: true };
  }
}

const MOCK = (key: string, label: string): Light => ({ key, status: 'mock', label, real: false });

// Revaluation light (Task 7, spec D12/D13): blocking-fact authority is the revaluation run
// itself (dual fingerprints) — this light is a projection, never re-derives its own notion of
// "current". Reuses loadRevaluationContext verbatim (same consumed-price-set / lot-set-hash
// computation orchestrate.ts uses for the run) so the light can never drift from what a run
// would actually persist.
//   - no run yet, OR the current position has a blocking PRICE_MISSING (unpriced/unregistered
//     held coin) → red.
//   - a run exists but its priceSetHash/lotSetHash/policySetVersion no longer match the
//     current position/prices/policy → stale (same predicate executeRun uses for the
//     REVAL_ALREADY_CURRENT replay gate, inverted).
//   - otherwise → green.
// Wrapped fail-closed like reconLight/registryLight: an unknown periodId (periodCutoff throws)
// or any other unexpected error must red the light, never 500 the whole cockpit.
function revaluationLight(db: Db, entityId: string, periodId: string): Light {
  try {
    const ctx = loadRevaluationContext(db, entityId, periodId);
    if (ctx.latest === null || ctx.priceMissing.length > 0) {
      return { key: 'revaluation', status: 'red', label: 'Revaluation', real: true };
    }
    const current = ctx.latest.priceSetHash === ctx.priceSetHash
      && ctx.latest.lotSetHash === ctx.lotSetHash
      && ctx.latest.policySetVersion === ctx.doc.policySetVersion;
    return { key: 'revaluation', status: current ? 'green' : 'stale', label: 'Revaluation', real: true };
  } catch {
    return { key: 'revaluation', status: 'red', label: 'Revaluation', real: true };
  }
}

export function buildCockpit(db: Db, entityId: string, periodId: string, lowConf: number): CockpitView {
  const lights: Light[] = [
    classificationLight(db, entityId, periodId, lowConf),
    jeLight(db, entityId, periodId),
    reconLight(db, entityId, periodId),
    registryLight(db, entityId, periodId),
    completenessLight(db, entityId, periodId),
    revaluationLight(db, entityId, periodId),
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
