// Task 3 — ASU 2023-08 roll-forward, compute-on-read.
// Formula is PINNED by docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md §5 (Candidate
// B: disposals at CARRYING, gains/losses = unrealized remeasurement delta only, sign-split per
// valuation row, OPENING_LOT counted as an addition in its own period — Choice X pure period
// boundary). Do NOT re-derive from accounting-spec §4.2's literal wording; the memo is the
// authority (user-ratified 2026-07-13; see memo §4 Deviation 1/2, Finding 2).
import type { Db } from '../store/db.js';
import { buildTrialBalance } from './trialBalance.js';
import { getActivePolicy } from '../store/policyStore.js';
import { periodCutoff } from '../store/pricePointStore.js';

export interface RollForwardRow {
  coinType: string;
  openingFvMinor: string; additionsMinor: string; disposalsMinor: string;
  gainsMinor: string; lossesMinor: string; closingFvMinor: string;
  identityOk: boolean;   // 恆等式①（逐資產）
}
export interface RollForward {
  notApplicable: boolean; reason: string | null;
  rows: RollForwardRow[];
  tbTie: { digitalAssetsClosingMinor: string; closingFvTotalMinor: string; ok: boolean } | null;
  identitiesOk: boolean;
}

interface MvRow { period: string; deltaCost: bigint }
interface LvRow { period: string; reason: string; delta: bigint }

const sum = <T>(xs: T[], f: (x: T) => bigint): bigint => xs.reduce((s, x) => s + f(x), 0n);

// SUI-scope-style read (memo §2): lot_movement filtered by coin_type, lot_valuation filtered by
// that lot_id set + superseded_by IS NULL (live only). Guards the empty-lot-set case explicitly
// (a naive `lot_id IN ()` is invalid SQL — see derivation test's readSuiRows for the same trap).
function readCoinRows(db: Db, entityId: string, coinType: string): { movements: MvRow[]; valsLive: LvRow[] } {
  const movements = (db.prepare(
    'SELECT period_id AS p, delta_cost_minor AS c FROM lot_movement WHERE entity_id = ? AND coin_type = ?',
  ).all(entityId, coinType) as Array<{ p: string; c: string }>).map((r) => ({ period: r.p, deltaCost: BigInt(r.c) }));

  const lots = (db.prepare(
    'SELECT DISTINCT lot_id FROM lot_movement WHERE entity_id = ? AND coin_type = ?',
  ).all(entityId, coinType) as Array<{ lot_id: string }>).map((r) => r.lot_id);

  if (lots.length === 0) return { movements, valsLive: [] };

  const placeholders = lots.map(() => '?').join(',');
  const valsLive = (db.prepare(
    `SELECT period_id AS p, reason AS r, delta_minor AS d FROM lot_valuation
      WHERE entity_id = ? AND superseded_by IS NULL AND lot_id IN (${placeholders})`,
  ).all(entityId, ...lots) as Array<{ p: string; r: string; d: string }>)
    .map((v) => ({ period: v.p, reason: v.r, delta: BigInt(v.d) }));

  return { movements, valsLive };
}

// memo §2/§5: closingFV(P) = openingFV(P) + additionsCost(P) − disposalsCarrying(P) + (gains − losses)(P)
function computeRow(db: Db, entityId: string, periodId: string, coinType: string): RollForwardRow {
  const cut = periodCutoff(periodId); // malformed periodId → throws (fail-closed, matches trialBalance)
  const before = (p: string): boolean => periodCutoff(p) < cut;
  const upTo = (p: string): boolean => periodCutoff(p) <= cut;
  const inP = (p: string): boolean => p === periodId;

  const { movements, valsLive } = readCoinRows(db, entityId, coinType);

  const openingFV = sum(movements.filter((m) => before(m.period)), (m) => m.deltaCost)
    + sum(valsLive.filter((v) => before(v.period)), (v) => v.delta);
  const closingFV = sum(movements.filter((m) => upTo(m.period)), (m) => m.deltaCost)
    + sum(valsLive.filter((v) => upTo(v.period)), (v) => v.delta);

  const mvInP = movements.filter((m) => inP(m.period));
  // additionsCost includes OPENING_LOT in its own period (Choice X — memo Finding 2): no
  // special-casing by event/reason here, purely period-boundary + sign of delta_cost.
  const additionsCost = sum(mvInP.filter((m) => m.deltaCost > 0n), (m) => m.deltaCost);
  const disposalsCost = -sum(mvInP.filter((m) => m.deltaCost < 0n), (m) => m.deltaCost);

  const releasesInP = valsLive.filter((v) => inP(v.period) && v.reason === 'DISPOSAL_RELEASE');
  const releaseRemoved = -sum(releasesInP, (v) => v.delta);
  const disposalsCarrying = disposalsCost + releaseRemoved;

  // gains/losses (memo Deviation 2): every LIVE non-release valuation delta in P (REVALUE, IMPAIR,
  // REVERSE, seq-0 OPENING_FV) — realized disposal P&L never enters this row. Sign-split is PER
  // ROW, not on the net total (a period could in principle mix REVALUE-up on one lot with
  // REVALUE-down/IMPAIR on another).
  let gains = 0n;
  let losses = 0n;
  for (const v of valsLive) {
    if (!inP(v.period) || v.reason === 'DISPOSAL_RELEASE') continue;
    if (v.delta > 0n) gains += v.delta;
    else if (v.delta < 0n) losses += -v.delta;
  }

  const identityOk = closingFV === openingFV + additionsCost - disposalsCarrying + gains - losses;

  return {
    coinType,
    openingFvMinor: openingFV.toString(),
    additionsMinor: additionsCost.toString(),
    disposalsMinor: disposalsCarrying.toString(),
    gainsMinor: gains.toString(),
    lossesMinor: losses.toString(),
    closingFvMinor: closingFV.toString(),
    identityOk,
  };
}

// Identity ② needs a per-coin DigitalAssets GL balance, restricted to the ASU-applicable coin
// set, through periodId's cutoff. buildTrialBalance's 'DigitalAssets' row (Task 1) aggregates
// EVERY coin into one row (services/api/src/reports/trialBalance.ts groups by l.account only —
// it never reads origCoinType), so it cannot serve a coin-scoped tie-out directly: an entity
// holding a non-ASU coin (e.g. USDC from a swap's consideration leg) in the same DigitalAssets
// account would contaminate the aggregate. This mirrors the derivation test's daBalanceThrough
// helper (reports.rollforward.derivation.test.ts) — same JE-line scan, filtered by origCoinType,
// summed over the ASU coin list. buildTrialBalance is still called (below, in buildRollForward)
// to honor the Task 1 consumption contract; this function is the coin-scoped read identity ②
// actually needs.
function digitalAssetsClosingForCoins(db: Db, entityId: string, periodId: string, coins: string[]): bigint {
  if (coins.length === 0) return 0n;
  const target = periodCutoff(periodId);
  const coinSet = new Set(coins);
  const rows = db.prepare('SELECT je_json AS j, period_id AS p FROM journal_entries WHERE entity_id = ?')
    .all(entityId) as Array<{ j: string; p: string }>;
  let bal = 0n;
  for (const r of rows) {
    if (periodCutoff(r.p) > target) continue;
    const je = JSON.parse(r.j) as {
      status?: string;
      lines: Array<{ account: string; side: string; amountMinor: string; origCoinType?: string | null }>;
    };
    if (je.status === 'VOIDED') continue;
    for (const l of je.lines) {
      if (l.account !== 'DigitalAssets' || !l.origCoinType || !coinSet.has(l.origCoinType)) continue;
      bal += l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor);
    }
  }
  return bal;
}

export function buildRollForward(db: Db, entityId: string, periodId: string): RollForward {
  const { doc } = getActivePolicy(db, entityId);
  if (doc.accountingStandard !== 'US_GAAP') {
    return { notApplicable: true, reason: doc.accountingStandard, rows: [], tbTie: null, identitiesOk: true };
  }

  const coins = Object.entries(doc.asu202308Applies).filter(([, v]) => v).map(([k]) => k);
  const rows = coins.map((coinType) => computeRow(db, entityId, periodId, coinType));

  // Consumed per Task 1 interface contract; the aggregate 'DigitalAssets' row is coin-blind (see
  // digitalAssetsClosingForCoins above) so it is not used for the coin-scoped tie-out itself.
  buildTrialBalance(db, entityId, periodId);

  const closingFvTotal = sum(rows, (r) => BigInt(r.closingFvMinor));
  const digitalAssetsClosing = digitalAssetsClosingForCoins(db, entityId, periodId, coins);
  const tbTie = {
    digitalAssetsClosingMinor: digitalAssetsClosing.toString(),
    closingFvTotalMinor: closingFvTotal.toString(),
    ok: digitalAssetsClosing === closingFvTotal,
  };

  return {
    notApplicable: false,
    reason: null,
    rows,
    tbTie,
    identitiesOk: rows.every((r) => r.identityOk) && tbTie.ok,
  };
}
