/**
 * Task 7 — 三視圖一致性測試 (TB / roll-forward / reconciliation), same seed as Task 2's
 * derivation scenario (reports.rollforward.derivation.test.ts: acquire → ASU transition →
 * period reval → partial disposal → rerun/supersede → cross-period reval → second disposal →
 * new-lot acquisition, GAAP FV track). Seed copied verbatim (per brief) rather than imported —
 * the derivation test does not export its helpers.
 *
 * WHY this test exists (Rule 9): TB (trialBalance.ts), roll-forward (rollForward.ts) and recon
 * (reconciliation/collect.ts) are three independently-written recompute-on-read views over the
 * SAME persisted rows (journal_entries / lot_movement / lot_valuation). Nothing forces them to
 * agree except that the underlying accounting is actually coherent. If a future change breaks
 * that coherence (e.g. a JE line silently lands on the wrong account, or a fold drops a row),
 * NONE of the three views' own unit tests would catch it — each only checks its own arithmetic
 * is internally consistent. This test cross-wires all three so a coherence break shows up
 * somewhere, and pins fixed numeric anchors (not just mutual equality) so a shared-seed bug that
 * moves all three by the same amount cannot slip through as "still all equal" (see Step 2 below
 * and the mutation note at the bottom).
 *
 * PITFALL #1 (empirically verified while writing this test, not assumed): buildTrialBalance's
 * plain 'DigitalAssets' row is NOT the right-hand side of the TB/roll-forward tie. TB groups by
 * account name only (trialBalance.ts never reads origCoinType) — it does not split by coin. In
 * this scenario, SPOT_TRADE_SWAP's ACQUISITION leg (the USDC received) posts to the SAME
 * 'DigitalAssets' account as SUI's own OPENING_LOT/DISPOSAL/REVALUE legs (see
 * services/rules-engine/src/rules/swapRules.ts + policyConstants.ts DEMO_COA_RULES — coaMapping
 * resolves by {eventType, leg} only, never coinType). Since USDC is never disposed of in this
 * scenario, its accumulated fv-cost balance sits in 'DigitalAssets' forever and contaminates the
 * aggregate: TB DigitalAssets closing = 155000 (Q2) / 225000 (Q3), NOT 80000 / 110000. This is
 * exactly why rollForward.ts's own tbTie does a coin-scoped JE scan
 * (digitalAssetsClosingForCoins, restricted to ASU-applicable coins) instead of calling
 * buildTrialBalance — see that function's comment. The identity this test pins is therefore:
 *   rf.tbTie.digitalAssetsClosingMinor (coin-scoped) == rf.tbTie.closingFvTotalMinor == anchor
 * NOT a naive `buildTrialBalance(...).rows.find('DigitalAssets').closingMinor == rf.closingFv...`
 * — that comparison is asserted here too, but as a NEGATIVE example (contamination proof), not
 * the tie.
 *
 * PITFALL #2 (spec'd in the brief, progress.md's "same suffix two meanings" lesson): recon's
 * `computed`/`movementMinor` (reconciliation/collect.ts + movement.ts's netByCoinType) is a
 * QUANTITY fold in COIN minor units (coin dp — SUI here is registered with 0 decimals, so its
 * "minor" unit is whole SUI). TB/roll-forward's *Minor fields are FIAT/functional-currency minor
 * units (2dp cents), i.e. lot cost/carrying/FV. These are DIFFERENT physical quantities that
 * happen to share the "...Minor" name — comparing them directly would be a unit error, not a
 * bug in either view. This test never compares recon's quantity fold to TB/RF's fiat fold;
 * instead it ties recon's quantity fold to an INDEPENDENT quantity-side fold (lot_movement's
 * delta_qty_minor, same physical unit) — see Step (b).
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
import { buildTrialBalance } from '../src/reports/trialBalance.js';
import { buildRollForward } from '../src/reports/rollForward.js';
import { collectBreaks } from '../src/reconciliation/collect.js';

const E = 'e1';
const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');
const Q2 = '2026-Q2';
const Q3 = '2026-Q3';

// ---- seed (verbatim copy of reports.rollforward.derivation.test.ts's scenario builders —
// that file does not export them, so they are duplicated here rather than imported) ----
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

// Independent quantity-side fold over lot_movement (SAME physical unit as recon's movementMinor:
// coin minor, i.e. SUI quantity — NOT fiat cost). Mirrors the derivation test's direct-DB-read
// style. OPENING_LOT rows are excluded (event_id filter) to match movement.ts's own exclusion —
// see reconciliation/movement.ts's comment: OPENING_LOT is a fixture-side opening balance, not
// period book movement, so its lot_movement acquire row must NOT be folded into the same total
// recon compares against (that would double-count against the fixture's openingMinor).
function suiQtyMovementExOpening(db: Db, entityId: string, openingEventIds: string[]): bigint {
  const placeholders = openingEventIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT delta_qty_minor AS q FROM lot_movement
      WHERE entity_id = ? AND coin_type = ? AND event_id NOT IN (${placeholders})`,
  ).all(entityId, SUI, ...openingEventIds) as Array<{ q: string }>;
  return rows.reduce((s, r) => s + BigInt(r.q), 0n);
}

// ---- Independent AMOUNT-side (fiat, lot carrying) fold — the missing third path flagged in
// review (Important 1/2): closes recon's money side against RF's tbTie WITHOUT calling anything
// in services/api/src/reports/ (that is the object under test). This mirrors
// reports.rollforward.derivation.test.ts's readSuiRows/rollTerms closingFV shape (both files
// independently hand-roll the same raw-SQL fold over lot_movement/lot_valuation — the shared
// technique is a deliberate cross-file convention, not duplication to clean up): sum
// lot_movement.delta_cost_minor (all periods <= P) plus lot_valuation.delta_minor for LIVE rows
// only (superseded_by IS NULL — supersede chains must not double-count a corrected revaluation),
// scoped to SUI's own lots and cut off at period P's boundary via periodCutoff (imported from the
// store layer, not from reports/).
function suiCarryingClosingMinor(db: Db, entityId: string, coinType: string, period: string): bigint {
  const cutoff = periodCutoff(period);
  const lotIds = (db.prepare('SELECT DISTINCT lot_id FROM lot_movement WHERE entity_id = ? AND coin_type = ?')
    .all(entityId, coinType) as Array<{ lot_id: string }>).map((r) => r.lot_id);
  const movementRows = db.prepare(
    `SELECT period_id AS p, delta_cost_minor AS c FROM lot_movement WHERE entity_id = ? AND coin_type = ?`,
  ).all(entityId, coinType) as Array<{ p: string; c: string }>;
  const movementTotal = movementRows
    .filter((r) => periodCutoff(r.p) <= cutoff)
    .reduce((s, r) => s + BigInt(r.c), 0n);
  if (lotIds.length === 0) return movementTotal;
  const placeholders = lotIds.map(() => '?').join(',');
  const valuationRows = db.prepare(
    `SELECT period_id AS p, delta_minor AS d FROM lot_valuation
      WHERE entity_id = ? AND superseded_by IS NULL AND lot_id IN (${placeholders})`,
  ).all(entityId, ...lotIds) as Array<{ p: string; d: string }>;
  const valuationTotal = valuationRows
    .filter((r) => periodCutoff(r.p) <= cutoff)
    .reduce((s, r) => s + BigInt(r.d), 0n);
  return movementTotal + valuationTotal;
}

describe('three-view consistency (TB / roll-forward / recon), same seed as Task 2 derivation', () => {
  it('roll-forward tbTie == fixed anchors; recon quantity fold ties lot_movement quantity fold; TB raw row is a documented non-tie', async () => {
    const app = await buildTestApp(false);
    await seedTwoPeriodScenario(app);

    // ---- (a) TB / roll-forward FV tie — via roll-forward's OWN coin-scoped tbTie, not a naive
    //      buildTrialBalance() row comparison (see PITFALL #1 above) ----
    const rfQ2 = buildRollForward(app._db, E, Q2);
    const rfQ3 = buildRollForward(app._db, E, Q3);
    expect(rfQ2.tbTie).not.toBeNull();
    expect(rfQ3.tbTie).not.toBeNull();
    // Fixed anchors (independent of the tie itself — non-vacuity guard, same anchors the
    // derivation test pins for closingFV): if the scenario amounts ever change, these break.
    // NOTE (review Important 1): this pair of assertions is a verbatim repeat of
    // reports.rollforward.test.ts:142-152's identity ② (rf.tbTie.digitalAssetsClosingMinor ==
    // rf.tbTie.closingFvTotalMinor == anchor) — it is NOT an independent third path for the
    // amount side. Kept here anyway as a same-file negative-example anchor for the
    // buildTrialBalance() contamination check right below (daQ2/daQ3), not as fresh coverage.
    // The actual independent amount-side tie is suiCarryingClosingMinor(...) further down,
    // which reads lot_movement/lot_valuation directly and never imports reports/.
    expect(rfQ2.tbTie!.closingFvTotalMinor).toBe('80000');
    expect(rfQ3.tbTie!.closingFvTotalMinor).toBe('110000');
    // (digitalAssetsClosingMinor === closingFvTotalMinor duplicate dropped: rfQ2.tbTie!.ok/
    // rfQ3.tbTie!.ok below already assert this equality — see rollForward.ts's tbTie.ok
    // definition — so re-asserting it verbatim here added no coverage.)
    expect(rfQ2.tbTie!.ok).toBe(true);
    expect(rfQ3.tbTie!.ok).toBe(true);
    expect(rfQ2.identitiesOk).toBe(true);
    expect(rfQ3.identitiesOk).toBe(true);

    // ---- Independent amount-side (fiat, lot carrying) third path (review Important 2): raw-SQL
    // fold over lot_movement + LIVE lot_valuation rows, computed entirely in this test file
    // without importing anything from services/api/src/reports/. Ties both the fixed anchors and
    // RF's own tbTie so a coherence break between RF's computation and the persisted lot rows
    // would show up here even if RF's internal arithmetic were self-consistently wrong. ----
    const carryingQ2 = suiCarryingClosingMinor(app._db, E, SUI, Q2);
    const carryingQ3 = suiCarryingClosingMinor(app._db, E, SUI, Q3);
    expect(carryingQ2).toBe(80000n);
    expect(carryingQ3).toBe(110000n);
    expect(carryingQ2).toBe(BigInt(rfQ2.tbTie!.closingFvTotalMinor));
    expect(carryingQ3).toBe(BigInt(rfQ3.tbTie!.closingFvTotalMinor));

    // ---- NEGATIVE EXAMPLE: buildTrialBalance's plain 'DigitalAssets' row IS actually consumed
    //      here (per the brief's interface list) — to PROVE, not merely assert, that it must not
    //      be used as the cross-view tie. It aggregates SUI (ASU-scoped) and USDC (swap
    //      consideration, never disposed in this scenario) into one account, so it does NOT equal
    //      closingFvTotalMinor. Anchored (not just "!=") so a future accidental fix to TB's
    //      coin-splitting doesn't silently make this assertion meaningless. ----
    const tbQ2 = buildTrialBalance(app._db, E, Q2);
    const tbQ3 = buildTrialBalance(app._db, E, Q3);
    const daQ2 = tbQ2.rows.find((r) => r.account === 'DigitalAssets');
    const daQ3 = tbQ3.rows.find((r) => r.account === 'DigitalAssets');
    expect(daQ2?.closingMinor).toBe('155000'); // 80000 (SUI, ties RF) + 75000 (USDC swap1 leg, contamination)
    expect(daQ3?.closingMinor).toBe('225000'); // 110000 (SUI, ties RF) + 115000 (USDC swap1+swap2 legs)
    expect(daQ2?.closingMinor).not.toBe(rfQ2.tbTie!.closingFvTotalMinor);
    expect(daQ3?.closingMinor).not.toBe(rfQ3.tbTie!.closingFvTotalMinor);

    // ---- (b) recon quantity-side fold ties an independent quantity-side fold (lot_movement) —
    //      unit is coin minor (SUI registered at 0 decimals here, so "minor" == whole SUI), NOT
    //      the fiat minor used in (a). See PITFALL #2 above: this is deliberately never compared
    //      to the fiat-side anchors 80000/110000. ----
    const breaks = collectBreaks(app._db, E, Q3);
    const suiBreak = breaks.find((b) => b.wallet === '0xacme' && b.coinType === SUI)!;
    expect(suiBreak).toBeDefined();
    // Fixed anchor: net 75 SUI disposed (50 + 25 across the two swaps), signed negative
    // (net outflow from the wallet's held quantity).
    expect(suiBreak.movementMinor).toBe('-75');
    expect(suiBreak.computedMinor).toBe('-75'); // no recon fixture for 'e1' → opening defaults 0

    const independentQtyFold = suiQtyMovementExOpening(app._db, E, ['open-sui', 'open-sui-2']);
    expect(independentQtyFold).toBe(-75n);
    expect(BigInt(suiBreak.movementMinor)).toBe(independentQtyFold);
  });
});
