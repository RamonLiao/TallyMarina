// Task 5 (period-end revaluation persistence, spec §5): revaluation_run + lot_valuation
// stores. Task 6 (run orchestration) and Task 10 (disposal release) import this module's
// exports verbatim — signatures here are a cross-task contract, not free to reshape.
//
// GUARDRAIL: nothing under src/ai/ may import this module (same rule as journalStore /
// lotMovementStore).
import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import type { PositionLot, ValuationBasis, ValuationState } from '../deps/rulesEngine.js';

export interface RevaluationRunRow {
  id: string; entityId: string; periodId: string; seq: number;
  priceSetHash: string; lotSetHash: string; policySetVersion: string; accountingStandard: string;
  reversalOfRunId: string | null; createdAt: string;
}

export interface LotValuationRow {
  id: string; entityId: string; lotId: string; periodId: string; runId: string;
  seq: number; basis: string; qtyMinor: string; priorCarryingMinor: string; currentValueMinor: string;
  deltaMinor: string; pricePointId: string | null; jeId: string | null; reason: string;
  policySetVersion: string; supersededBy: string | null; createdAt: string;
}

// D6: only these reasons may ever land in lot_valuation. Anything else is corruption
// (a hand-crafted row, a bug elsewhere) — fold must fail loud rather than silently fold it in.
// NOTE: DISPOSAL_RELEASE is deliberately wider than rules-engine's LotValuationDraft.reason
// union — the engine never emits it; Task 10 (disposal carry-out) writes it directly via
// insertValuation. Its (negative) delta folds into cumulativeDelta like any other row.
const VALID_REASONS = new Set(['REVALUE', 'IMPAIR', 'REVERSE', 'OPENING_FV', 'DISPOSAL_RELEASE']);

export class RevaluationDataError extends Error {
  code: 'VALUATION_CORRUPT' = 'VALUATION_CORRUPT';
  constructor(message: string) {
    super(message);
    this.name = 'RevaluationDataError';
  }
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

export function insertRun(db: Db, r: Omit<RevaluationRunRow, 'id' | 'seq' | 'createdAt'>): RevaluationRunRow {
  // Monotonic per (entity, period): COUNT+1 inside this call. better-sqlite3 is synchronous
  // (no interleaving within a process) so this mirrors the same COUNT+1-then-INSERT pattern
  // pricePointStore uses for its ids — no separate sequence table needed (SUI S2).
  const countRow = db.prepare(
    'SELECT COUNT(*) AS n FROM revaluation_run WHERE entity_id = ? AND period_id = ?',
  ).get(r.entityId, r.periodId) as { n: number };
  const seq = countRow.n + 1;
  const id = `rv-${r.entityId}-${shortHash(r.periodId)}-${seq}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO revaluation_run
       (id, entity_id, period_id, seq, price_set_hash, lot_set_hash, policy_set_version, accounting_standard, reversal_of_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.entityId, r.periodId, seq, r.priceSetHash, r.lotSetHash, r.policySetVersion, r.accountingStandard, r.reversalOfRunId, createdAt);
  return { ...r, id, seq, createdAt };
}

export function latestRun(db: Db, entityId: string, periodId: string): RevaluationRunRow | null {
  const row = db.prepare(
    'SELECT * FROM revaluation_run WHERE entity_id = ? AND period_id = ? ORDER BY seq DESC LIMIT 1',
  ).get(entityId, periodId) as Record<string, unknown> | undefined;
  return row ? fromRunRow(row) : null;
}

// `idSuffix` (optional, additive): Task 6's per-run REVALUE/IMPAIR/REVERSE/OPENING_FV rows
// are naturally unique per (entity, lot, run, seq, reason) — at most one row per lot per
// reason per run. Task 10's DISPOSAL_RELEASE rows are NOT run-scoped that way: two separate
// disposal events consuming the SAME lot while it's still under the SAME latest run/seq (no
// intervening revaluation) would otherwise collide on the exact same id and the second
// INSERT would throw a raw UNIQUE-constraint error instead of failing loud with context.
// Pass the disposing event's own id as idSuffix to disambiguate; omitted, id generation is
// BYTE-IDENTICAL to before this parameter existed (Task 6 call sites untouched).
export function insertValuation(
  db: Db, r: Omit<LotValuationRow, 'id' | 'createdAt'>, idSuffix?: string,
): LotValuationRow {
  const id = `lv-${r.entityId}-${shortHash(r.lotId)}-${r.runId}-${r.seq}-${r.reason}${idSuffix ? `-${idSuffix}` : ''}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO lot_valuation
       (id, entity_id, lot_id, period_id, run_id, seq, basis, qty_minor, prior_carrying_minor,
        current_value_minor, delta_minor, price_point_id, je_id, reason, policy_set_version, superseded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.entityId, r.lotId, r.periodId, r.runId, r.seq, r.basis, r.qtyMinor, r.priorCarryingMinor,
    r.currentValueMinor, r.deltaMinor, r.pricePointId, r.jeId, r.reason, r.policySetVersion, r.supersededBy, createdAt);
  return { ...r, id, createdAt };
}

// Task 10 (disposal release, spec §4.5): a DISPOSAL_RELEASE row is written OUTSIDE any
// revaluation run (during run-rules disposal posting), so it has no run of its own — it must
// borrow (run_id, seq, basis) from the lot's own latest unsuperseded valuation row, both so
// foldValuationStates' run_id FK-existence check (line ~137) passes trivially (the run already
// exists) and so the released delta is folded under the SAME basis the lot was revalued under
// (CPA B2 mixed-basis guard). Returns null for a lot that was never revalued — callers must
// skip writing a release row in that case (nothing to release).
export function latestValuationForLot(db: Db, entityId: string, lotId: string): LotValuationRow | null {
  const row = db.prepare(
    `SELECT * FROM lot_valuation WHERE entity_id = ? AND lot_id = ? AND superseded_by IS NULL
     ORDER BY seq DESC LIMIT 1`,
  ).get(entityId, lotId) as Record<string, unknown> | undefined;
  return row ? fromValuationRow(row) : null;
}

// D6: seq=0 (opening/transition) rows are permanent — a later run recomputing the same lot
// supersedes only its own >=1 run-seq predecessors, never the opening row. The WHERE seq > 0
// guard is the entire enforcement of that invariant; removing it would let a routine
// re-valuation run silently erase the ASU-2023-08 opening baseline.
export function supersedeValuationsOfRun(db: Db, runId: string, byRunId: string): number {
  const result = db.prepare(
    'UPDATE lot_valuation SET superseded_by = ? WHERE run_id = ? AND seq > 0',
  ).run(byRunId, runId);
  return result.changes;
}

// SUI S3-style input domain hash: same set in, same hash out, independent of read order.
export function lotSetHash(lots: PositionLot[]): string {
  const entries = lots.map((l) => `${l.lotId}:${l.remainingQtyMinor}`).sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

// Fail-closed read-side fold: this is the sole path by which persisted lot_valuation rows
// become a ValuationState fed back into the rules-engine (Task 6). A dirty row — unknown
// basis, unknown reason, negative qty, an orphan run_id, or impairment reversed past zero —
// must never silently flow into a revaluation input; throw RevaluationDataError instead.
export function foldValuationStates(
  db: Db, entityId: string, lotIds: string[], expectedBasis: ValuationBasis,
): Record<string, ValuationState> {
  if (lotIds.length === 0) return {};
  const placeholders = lotIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM lot_valuation WHERE entity_id = ? AND lot_id IN (${placeholders}) AND superseded_by IS NULL
     ORDER BY lot_id ASC, seq ASC, created_at ASC`,
  ).all(entityId, ...lotIds) as Record<string, unknown>[];

  const acc = new Map<string, { delta: bigint; impairment: bigint; latestQty: bigint; hasOpeningSeq0: boolean }>();
  const verifiedRunIds = new Set<string>(); // avoid an N+1 SELECT per valuation row
  for (const raw of rows) {
    const row = fromValuationRow(raw);
    if (row.basis !== expectedBasis) {
      throw new RevaluationDataError(
        `foldValuationStates: lot_valuation row ${row.id} (lot ${row.lotId}) has basis '${row.basis}', `
        + `expected '${expectedBasis}' — mixed-basis read (CPA B2)`,
      );
    }
    if (!VALID_REASONS.has(row.reason)) {
      throw new RevaluationDataError(`foldValuationStates: lot_valuation row ${row.id} has unknown reason '${row.reason}'`);
    }
    let qty: bigint;
    let delta: bigint;
    try { qty = BigInt(row.qtyMinor); } catch {
      throw new RevaluationDataError(`foldValuationStates: lot_valuation row ${row.id} has non-integer qty_minor '${row.qtyMinor}'`);
    }
    if (qty < 0n) {
      throw new RevaluationDataError(`foldValuationStates: lot_valuation row ${row.id} has negative qty_minor '${row.qtyMinor}'`);
    }
    try { delta = BigInt(row.deltaMinor); } catch {
      throw new RevaluationDataError(`foldValuationStates: lot_valuation row ${row.id} has non-integer delta_minor '${row.deltaMinor}'`);
    }
    if (row.runId && !verifiedRunIds.has(row.runId)) {
      const runExists = db.prepare('SELECT 1 FROM revaluation_run WHERE id = ?').get(row.runId);
      if (!runExists) {
        throw new RevaluationDataError(`foldValuationStates: lot_valuation row ${row.id} references orphan run_id '${row.runId}'`);
      }
      verifiedRunIds.add(row.runId);
    }
    const cur = acc.get(row.lotId) ?? { delta: 0n, impairment: 0n, latestQty: 0n, hasOpeningSeq0: false };
    cur.delta += delta;
    if (row.reason === 'IMPAIR') cur.impairment += delta < 0n ? -delta : delta;
    if (row.reason === 'REVERSE') cur.impairment -= delta;
    cur.latestQty = qty; // ascending seq order within a lot → last write is the highest seq
    if (row.seq === 0) cur.hasOpeningSeq0 = true;
    acc.set(row.lotId, cur);
  }

  const result: Record<string, ValuationState> = {};
  for (const [lotId, v] of acc) {
    if (v.impairment < 0n) {
      throw new RevaluationDataError(
        `foldValuationStates: lot ${lotId} has negative cumulative impairment (${v.impairment}) — REVERSE exceeded IMPAIR`,
      );
    }
    result[lotId] = {
      lotId,
      cumulativeDeltaMinor: v.delta.toString(),
      cumulativeImpairmentMinor: v.impairment.toString(),
      qtyAtLastValuationMinor: v.latestQty.toString(),
      hasOpeningSeq0: v.hasOpeningSeq0,
    };
  }
  return result;
}

// Task 10 (spec §4.5, CPA B1 — external-review fix): `cumulativeDeltaMinor` above sums BOTH
// the period P&L-booked REVALUE delta AND the one-time ASU-transition (OPENING_FV) delta,
// which is booked straight to RetainedEarnings/equity and explicitly never touches P&L (§4.4
// "均不進當期P&L"). Reclassifying the WHOLE cumulative delta into UnrealizedGainCryptoPnL/
// DisposalGain on disposal (the original Task 10 draft) would corrupt UnrealizedGainCryptoPnL's
// balance and, for a disposal in a period AFTER the triggering reval, fabricate a current-period
// P&L swing for a gain that account never recognized.
//
// Returns per-lot { rawPnl, rawOpening } — UNPRORATED raw sums (REVALUE-reason rows only, and
// the single seq=0 OPENING_FV row if any). The caller derives how much of the P&L bucket
// SURVIVES after any prior partial-disposal releases via the exact ratio
// `rawPnl * cumulativeDeltaMinor / (rawPnl + rawOpening)` — valid because every release
// (attributedTakenDelta in routes.ts) always shrinks the total by the SAME qty ratio, so by
// linearity that ratio applies uniformly to every additive sub-component of the total,
// including the P&L-only sub-component. This mirrors attributedImpairment's self-correcting
// qty-ratio pattern (revalue.ts) rather than writing a separate release row per bucket — no
// schema change, and correct across any number of sequential partial disposals.
export function rawDeltaComponents(
  db: Db, entityId: string, lotIds: string[],
): Record<string, { rawPnl: string; rawOpening: string }> {
  if (lotIds.length === 0) return {};
  const placeholders = lotIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT lot_id, reason, delta_minor FROM lot_valuation
     WHERE entity_id = ? AND lot_id IN (${placeholders}) AND superseded_by IS NULL
       AND reason IN ('REVALUE', 'OPENING_FV')`,
  ).all(entityId, ...lotIds) as Array<{ lot_id: string; reason: string; delta_minor: string }>;
  const acc = new Map<string, { pnl: bigint; opening: bigint }>();
  for (const r of rows) {
    const cur = acc.get(r.lot_id) ?? { pnl: 0n, opening: 0n };
    if (r.reason === 'REVALUE') cur.pnl += BigInt(r.delta_minor);
    else cur.opening += BigInt(r.delta_minor); // at most one OPENING_FV row per lot (D6)
    acc.set(r.lot_id, cur);
  }
  const result: Record<string, { rawPnl: string; rawOpening: string }> = {};
  for (const [lotId, v] of acc) result[lotId] = { rawPnl: v.pnl.toString(), rawOpening: v.opening.toString() };
  return result;
}

function fromRunRow(r: Record<string, unknown>): RevaluationRunRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, periodId: r.period_id as string,
    seq: r.seq as number, priceSetHash: r.price_set_hash as string, lotSetHash: r.lot_set_hash as string,
    policySetVersion: r.policy_set_version as string, accountingStandard: r.accounting_standard as string,
    reversalOfRunId: (r.reversal_of_run_id as string | null) ?? null, createdAt: r.created_at as string,
  };
}

function fromValuationRow(r: Record<string, unknown>): LotValuationRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, lotId: r.lot_id as string,
    periodId: r.period_id as string, runId: r.run_id as string, seq: r.seq as number,
    basis: r.basis as string, qtyMinor: r.qty_minor as string, priorCarryingMinor: r.prior_carrying_minor as string,
    currentValueMinor: r.current_value_minor as string, deltaMinor: r.delta_minor as string,
    pricePointId: (r.price_point_id as string | null) ?? null, jeId: (r.je_id as string | null) ?? null,
    reason: r.reason as string, policySetVersion: r.policy_set_version as string,
    supersededBy: (r.superseded_by as string | null) ?? null, createdAt: r.created_at as string,
  };
}
