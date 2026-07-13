/**
 * Task 2 — Roll-forward 恆等式 executable derivation (pins the formula Task 3 implements).
 *
 * WHY this test exists (Rule 9): §11.2 states the roll-forward identity
 *   期初FV + additions − disposals + gains − losses = 期末FV
 * but leaves the ALGEBRA underspecified — do disposals subtract at COST or at CARRYING, and is
 * the realized-reclass double-counted? Getting that wrong re-runs commit 592be8a's residual
 * battle. This test does NOT trust a hand-derivation: it drives a REAL two-period revaluation
 * scenario (acquire → transition → period reval → partial disposal → rerun/supersede → cross-
 * period reval → second disposal → new-lot acquisition) through the actual HTTP engine, reads
 * the persisted lot_movement / lot_valuation rows, and computes TWO rival identities per period:
 *
 *   Candidate A (spec-literal §4.2 — disposals at COST, gains = pnlBuckets-style
 *               unrealized + realized-reclass):
 *     closing =? opening + additionsCost − disposalsCost + unrealizedA + realizedReclass
 *   Candidate B (disposals at CARRYING — cost + released valuation; gains = unrealized
 *               remeasurement only, realized gain never touches the asset balance):
 *     closing =? opening + additionsCost − disposalsCarrying + gainsB
 *
 * FINDING (see docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md): Candidate B is
 * EXACT (zero residual) every period; Candidate A over-states by a period-specific residual
 * (Q2 +10000, Q3 +45000) because subtracting disposals at cost while ALSO adding the realized
 * reclass as a gain counts the released valuation twice. B is the formula Task 3 must implement.
 *
 * The identity B==closing is, by construction, an ALGEBRAIC identity over whatever rows the
 * engine wrote — so it can never fail on its own (that is the proof that B is *the* roll-forward
 * law, not a coincidence). The teeth of this test are therefore the FIXED anchors
 * (closing 80000/110000, the DA-GL tie-out, the A residuals) plus the mutation recorded in the
 * memo (swap disposalsCarrying→disposalsCost in B → Q2 goes red by 20000). Change any scenario
 * amount and the fixed anchors break; use a wrong disposal basis and the B identity breaks.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { canonicalCoinType } from '../src/assets/normalize.js';
import { periodCutoff } from '../src/store/pricePointStore.js';

const E = 'e1';
const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');
const Q2 = '2026-Q2';
const Q3 = '2026-Q3';

interface RawOver { [k: string]: unknown }
function opening(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'open-sui', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '100', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '100000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function swap(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'swp1', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '50', eventTime: '2026-06-15T00:00:00Z',
    economicPurpose: 'SPOT_TRADE_SWAP', ownershipChange: true,
    considerationAsset: USDC, considerationQtyMinor: '75000', considerationDecimals: 0,
    rawPayloadHash: 'swphash', txDigest: 'DIGSWP', eventIndex: 0, ...over,
  };
}
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, { aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO' });
}
async function runRules(app: FastifyInstance, periodId: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId } });
  expect(r.statusCode).toBe(200);
}
async function runReval(app: FastifyInstance, periodId: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId } });
  expect(r.statusCode).toBe(201);
}
async function postPriceAt(app: FastifyInstance, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}

// ---- row shapes read back from the stores (SUI-scoped) ----
interface Mv { period: string; deltaCost: bigint }
interface Lv { period: string; reason: string; delta: bigint; pnl: bigint | null }

// DigitalAssets GL balance for one coin, restricted to JEs whose period is at/ before P
// (identity ②: closingFV must tie the SUI-scoped DigitalAssets closing balance).
function daBalanceThrough(db: Db, coin: string, targetPeriod: string): bigint {
  const target = periodCutoff(targetPeriod);
  const rows = db.prepare('SELECT je_json AS j, period_id AS p FROM journal_entries WHERE entity_id = ?')
    .all(E) as Array<{ j: string; p: string }>;
  let bal = 0n;
  for (const r of rows) {
    if (periodCutoff(r.p) > target) continue;
    const je = JSON.parse(r.j) as { status?: string; lines: Array<{ account: string; side: string; amountMinor: string; origCoinType?: string | null }> };
    if (je.status === 'VOIDED') continue;
    for (const l of je.lines) {
      if (l.account !== 'DigitalAssets' || l.origCoinType !== coin) continue;
      bal += l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor);
    }
  }
  return bal;
}

const sum = <T>(xs: T[], f: (x: T) => bigint): bigint => xs.reduce((s, x) => s + f(x), 0n);

interface RollTerms {
  openingFV: bigint; closingFV: bigint;
  additionsCost: bigint; disposalsCost: bigint; disposalsCarrying: bigint;
  gainsB: bigint; unrealizedA: bigint; realizedReclass: bigint;
  candidateB: bigint; candidateA: bigint;
}
// Pure derivation over the persisted rows — this is the executable spec Task 3 copies.
// Period attribution is the pure period boundary (Choice X): openingFV(P) folds everything with
// period < P, closingFV(P) everything with period <= P — so openingFV(P) == closingFV(P−1)
// (continuity) and OPENING_LOT is an ADDITION in its own period (it must be, or the adoption
// period's identity leaks the opening cost — see memo §Finding 2).
function rollTerms(P: string, movements: Mv[], valsLive: Lv[]): RollTerms {
  const cut = periodCutoff(P);
  const upTo = (per: string): boolean => periodCutoff(per) <= cut;
  const before = (per: string): boolean => periodCutoff(per) < cut;
  const inP = (per: string): boolean => per === P;

  const openingFV = sum(movements.filter((m) => before(m.period)), (m) => m.deltaCost)
    + sum(valsLive.filter((v) => before(v.period)), (v) => v.delta);
  const closingFV = sum(movements.filter((m) => upTo(m.period)), (m) => m.deltaCost)
    + sum(valsLive.filter((v) => upTo(v.period)), (v) => v.delta);

  const mvInP = movements.filter((m) => inP(m.period));
  const additionsCost = sum(mvInP.filter((m) => m.deltaCost > 0n), (m) => m.deltaCost);
  const disposalsCost = -sum(mvInP.filter((m) => m.deltaCost < 0n), (m) => m.deltaCost);

  const releasesInP = valsLive.filter((v) => inP(v.period) && v.reason === 'DISPOSAL_RELEASE');
  const releaseRemoved = -sum(releasesInP, (v) => v.delta);        // released carrying leaving the asset
  const disposalsCarrying = disposalsCost + releaseRemoved;
  const realizedReclass = -sum(releasesInP, (v) => v.pnl ?? 0n);   // P&L share reclassified to realized

  // Candidate B gains = ALL non-release live valuation deltas in P (REVALUE/IMPAIR/REVERSE +
  // the seq-0 OPENING_FV transition) — every carrying change that is not a disposal.
  const gainsB = sum(valsLive.filter((v) => inP(v.period) && v.reason !== 'DISPOSAL_RELEASE'), (v) => v.delta);
  // Candidate A "unrealized" per §4.2 excludes the equity-booked OPENING_FV transition.
  const unrealizedA = sum(
    valsLive.filter((v) => inP(v.period) && ['REVALUE', 'IMPAIR', 'REVERSE'].includes(v.reason)),
    (v) => v.delta,
  );

  const candidateB = openingFV + additionsCost - disposalsCarrying + gainsB;
  const candidateA = openingFV + additionsCost - disposalsCost + unrealizedA + realizedReclass;
  return { openingFV, closingFV, additionsCost, disposalsCost, disposalsCarrying, gainsB, unrealizedA, realizedReclass, candidateB, candidateA };
}

async function seedTwoPeriodScenario(app: FastifyInstance & { _db: Db }): Promise<void> {
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  registerTestAsset(app._db, E, SUI, 0);
  registerTestAsset(app._db, E, USDC, 0);

  // ---- Q2: opening lot A (100 SUI, cost 100000) ----
  seedAuto(app._db, 'open-sui', opening());
  await runRules(app, Q2);
  const pol = await app.inject({ method: 'PATCH', url: '/policy/policy-set', payload: { entity: E, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } } } });
  expect(pol.statusCode).toBe(200);
  await postPriceAt(app, SUI, '2026-06-30', '12.00');   // transition: OPENING_FV +20000 (equity, seq-0)
  await runReval(app, Q2);
  await postPriceAt(app, SUI, '2026-06-30', '14.00');   // period reval R1 +20000 (P&L)
  await runReval(app, Q2);
  // Partial disposal #1 (50 of 100 SUI) → release −20000 (pnl −10000).
  await postPriceAt(app, USDC, '2026-06-15', '0.01');
  seedAuto(app._db, 'swp1', swap());
  await runRules(app, Q2);
  // Rerun @ corrected 16.00 → R1 superseded + reversed, fresh R3 +30000. Q2 closing = 80000.
  await postPriceAt(app, USDC, '2026-06-30', '0.01');
  await postPriceAt(app, SUI, '2026-06-30', '16.00');
  await runReval(app, Q2);

  // ---- Q3: acquire lot B (30 SUI, cost 30000), cross-period reval, second disposal ----
  seedAuto(app._db, 'open-sui-2', opening({ eventId: 'open-sui-2', quantityMinor: '30', openingCostMinor: '30000', eventTime: '2026-08-01T00:00:00Z', txDigest: 'DIG2', rawPayloadHash: 'beef2', eventIndex: 1 }));
  await runRules(app, Q3);
  await postPriceAt(app, SUI, '2026-09-30', '20.00');   // reval both lots @ Q3 cutoff: A +20000, B +30000
  await postPriceAt(app, USDC, '2026-09-30', '0.01');
  await runReval(app, Q3);
  // Second disposal (25 of remaining 50 SUI, lot A via FIFO) → release −25000 (pnl −20000).
  await postPriceAt(app, USDC, '2026-08-15', '0.01');
  seedAuto(app._db, 'swp2', swap({ eventId: 'swp2', quantityMinor: '25', considerationQtyMinor: '40000', eventTime: '2026-08-15T00:00:00Z', txDigest: 'DIGSWP2', rawPayloadHash: 'swphash2' }));
  await runRules(app, Q3);
}

// Read SUI-scoped movements and LIVE valuations (superseded_by IS NULL) straight from the stores.
function readSuiRows(db: Db): { movements: Mv[]; valsLive: Lv[] } {
  const suiLots = (db.prepare('SELECT DISTINCT lot_id FROM lot_movement WHERE entity_id = ? AND coin_type = ?')
    .all(E, SUI) as Array<{ lot_id: string }>).map((r) => r.lot_id);
  const placeholders = suiLots.map(() => '?').join(',');
  const movements = (db.prepare(
    `SELECT period_id AS p, delta_cost_minor AS c FROM lot_movement WHERE entity_id = ? AND coin_type = ?`,
  ).all(E, SUI) as Array<{ p: string; c: string }>).map((r) => ({ period: r.p, deltaCost: BigInt(r.c) }));
  const valsLive = (db.prepare(
    `SELECT period_id AS p, reason AS r, delta_minor AS d, pnl_delta_minor AS pnl
       FROM lot_valuation WHERE entity_id = ? AND superseded_by IS NULL AND lot_id IN (${placeholders})`,
  ).all(E, ...suiLots) as Array<{ p: string; r: string; d: string; pnl: string | null }>)
    .map((v) => ({ period: v.p, reason: v.r, delta: BigInt(v.d), pnl: v.pnl === null ? null : BigInt(v.pnl) }));
  return { movements, valsLive };
}

describe('roll-forward identity derivation (real revaluation scenario, pins Task 3 formula)', () => {
  it('Candidate B (disposals at carrying) is exact every period; Candidate A (disposals at cost + realized reclass) over-states', async () => {
    const app = await buildTestApp(false);
    await seedTwoPeriodScenario(app);
    const { movements, valsLive } = readSuiRows(app._db);

    const q2 = rollTerms(Q2, movements, valsLive);
    const q3 = rollTerms(Q3, movements, valsLive);

    // --- FIXED anchors: break if any scenario amount changes (non-vacuity guard) ---
    expect(q2.closingFV).toBe(80000n);
    expect(q3.closingFV).toBe(110000n);
    expect(q2.openingFV).toBe(0n);                 // adoption period starts at zero
    expect(q3.openingFV).toBe(80000n);             // == Q2 closing (roll-forward continuity)

    // --- Candidate B: EXACT zero residual, both periods (this is the pinned identity) ---
    expect(q2.candidateB).toBe(q2.closingFV);
    expect(q3.candidateB).toBe(q3.closingFV);

    // --- Candidate A: NON-zero residual — subtracting disposals at cost while also adding the
    //     realized reclass double-counts the released valuation. Anchored residual amounts. ---
    expect(q2.candidateA - q2.closingFV).toBe(10000n);
    expect(q3.candidateA - q3.closingFV).toBe(45000n);
    expect(q2.candidateA).not.toBe(q2.closingFV);
    expect(q3.candidateA).not.toBe(q3.closingFV);

    // --- Anchored per-line terms (so the memo's mapping is test-backed) ---
    expect(q2).toMatchObject({ additionsCost: 100000n, disposalsCost: 50000n, disposalsCarrying: 70000n, gainsB: 50000n, unrealizedA: 30000n, realizedReclass: 10000n });
    expect(q3).toMatchObject({ additionsCost: 30000n, disposalsCost: 25000n, disposalsCarrying: 50000n, gainsB: 50000n, unrealizedA: 50000n, realizedReclass: 20000n });

    // --- Identity ②: closingFV ties the SUI-scoped DigitalAssets GL balance at each period ---
    expect(q2.closingFV).toBe(daBalanceThrough(app._db, SUI, Q2));
    expect(q3.closingFV).toBe(daBalanceThrough(app._db, SUI, Q3));
  });
});
