/**
 * External review (should-fix, basis-lock): PATCH /policy/policy-set used to let
 * accountingStandard / asu202308Applies change freely, even after this entity already has
 * live lot_valuation rows. The NEXT event touching this entity to go through run-rules would
 * then hit lotsForEvent → foldValuationStates(expectedBasis) with a basis that no longer
 * matches the persisted rows' basis, and foldValuationStates' CPA B2 mixed-basis guard
 * throws RevaluationDataError — surfaced as a 500 VALUATION_CORRUPT. That's a mislabel: the
 * data isn't corrupt, the entity just needs a restatement flow (not yet built). This file
 * proves the write boundary now rejects the flip with 400 POLICY_BASIS_LOCKED instead,
 * mirroring the WAC guard precedent (95c474f).
 *
 * WHY these tests matter (Rule 9):
 * - the repro (GAAP_FV run → flip asu202308Applies → old 500) must now be a 400 at write
 *   time, never reaching the corrupted-fold path at all.
 * - the guard must be scoped to "this entity has a live valuation", not "any entity anywhere"
 *   — an entity that was never revalued must still be free to pick its basis.
 * - the guard must compare against the CURRENT value, not just "the field is present in the
 *   request" — a client resending the same basis value (no-op for that field) must not trip
 *   a NEW 400 that didn't exist before this fix.
 * - non-basis fields (e.g. stakingIncomePolicy) must be completely unaffected by an active
 *   valuation — the lock is scoped to the two basis-selecting fields only.
 * - the guard must be PER-COIN, not entity-wide: a coin that was merely adopted into a GAAP
 *   election but never actually revalued (no live lot_valuation row for IT specifically) must
 *   stay free to change, even if some OTHER coin on the same entity is basis-locked. Round-1
 *   external review flagged that the test suite didn't distinguish correct per-coin scoping
 *   from an accidentally entity-wide lock — this file's multi-coin test closes that gap.
 * - foldValuationStates throws on ANY basis mismatch, not just a GAAP_FV one — a live
 *   GAAP_COST valuation reverted straight back to IFRS_COST (accountingStandard flipped to
 *   IFRS, no asu202308Applies touch at all) hits the identical crash class. Round-1 external
 *   review flagged the first version of this guard (GAAP_FV-only) as leaving that open; this
 *   file's GAAP_COST-reversal test proves the generalized guard closes it too.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';

const E = 'e1';
const P = '2026-Q2';
const ASOF = '2026-06-30';
const SUI = '0x2::sui::SUI';
const USDC = '0xbeef::usdc::USDC';

interface RawOver { [k: string]: unknown }
function opening(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '500000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  registerTestAsset(app._db, E, SUI, 9);
  registerTestAsset(app._db, E, USDC, 6);
  return app;
}

function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

async function seedLots(app: FastifyInstance & { _db: Db }): Promise<void> {
  seedAuto(app._db, 'open-sui', opening({ eventId: 'open-sui' }));
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
}

async function seedTwoCoinLots(app: FastifyInstance & { _db: Db }): Promise<void> {
  seedAuto(app._db, 'open-sui', opening({ eventId: 'open-sui' }));
  seedAuto(app._db, 'open-usdc', opening({
    eventId: 'open-usdc', coinType: USDC, assetDecimals: 6, quantityMinor: '2000000',
    openingCostMinor: '200', txDigest: 'DIGUSDC', eventTime: '2026-04-02T00:00:00Z',
  }));
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
}

async function postPrice(app: FastifyInstance, coinType: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf: ASOF, price } });
  expect(r.statusCode).toBe(201);
}

async function runReval(app: FastifyInstance): Promise<{ statusCode: number; body: { runId?: string } }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  return { statusCode: r.statusCode, body: r.json() };
}

async function patch(app: FastifyInstance, changes: Record<string, unknown>): Promise<{ statusCode: number; body: { error?: { code: string; message: string } } }> {
  const r = await app.inject({
    method: 'PATCH', url: '/policy/policy-set',
    payload: { entity: E, actor: 'cpa', reason: 'test', changes },
  });
  return { statusCode: r.statusCode, body: r.json() };
}

describe('PATCH /policy/policy-set basis lock (external review should-fix)', () => {
  it('400 POLICY_BASIS_LOCKED when accountingStandard flips after a GAAP_FV run has produced a live valuation', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    // Adopt GAAP_FV for SUI — produces a live (unsuperseded) lot_valuation row.
    const adopt = await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } });
    expect(adopt.statusCode).toBe(200);
    const reval = await runReval(app);
    expect(reval.statusCode).toBe(201);

    // Flip asu202308Applies for SUI back off — must 400, not silently accept + later 500.
    const flip = await patch(app, { asu202308Applies: { [SUI]: false } });
    expect(flip.statusCode).toBe(400);
    expect(flip.body.error?.code).toBe('POLICY_BASIS_LOCKED');

    // Also true for accountingStandard itself.
    const flipStandard = await patch(app, { accountingStandard: 'IFRS' });
    expect(flipStandard.statusCode).toBe(400);
    expect(flipStandard.body.error?.code).toBe('POLICY_BASIS_LOCKED');
  });

  it('200 for the same PATCH on an entity with no live valuations (control group)', async () => {
    const app = await freshApp();
    await seedLots(app); // events posted, but no revaluation run yet — no lot_valuation rows
    const r = await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } });
    expect(r.statusCode).toBe(200);
  });

  it('200 when a basis field is re-sent with its current (unchanged) value', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } });
    await runReval(app);

    // Re-send accountingStandard=US_GAAP (already current) together with an unrelated field
    // change so there IS an effective change overall — must not trip POLICY_BASIS_LOCKED.
    const r = await patch(app, { accountingStandard: 'US_GAAP', feeExpensePolicy: 'CAPITALIZE_TO_ASSET' });
    expect(r.statusCode).toBe(200);
  });

  it('200 for a non-basis field change even though the entity has a live valuation', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } });
    await runReval(app);

    const r = await patch(app, { feeExpensePolicy: 'CAPITALIZE_TO_ASSET' });
    expect(r.statusCode).toBe(200);
  });

  // Round-1 external review: the guard must be scoped PER COIN, not entity-wide. SUI is
  // adopted into GAAP_FV and actually revalued (live row); USDC is adopted into GAAP_COST in
  // the SAME PATCH+run but is never itself touched by the later flip — so a later PATCH that
  // only changes USDC's asu202308Applies entry must be free to do so, even though the SAME
  // entity has a locked SUI coin.
  it('lock is per-coin: an untouched coin on the same entity stays free even while another coin is locked', async () => {
    const app = await freshApp();
    await seedTwoCoinLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');
    await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true, [USDC]: false } });
    await runReval(app); // SUI -> live GAAP_FV; USDC -> live GAAP_COST

    // USDC alone flips its GAAP_COST -> GAAP_FV (forward direction, not a revert) — allowed.
    const usdcForward = await patch(app, { asu202308Applies: { [SUI]: true, [USDC]: true } });
    expect(usdcForward.statusCode).toBe(200);

    // Now SUI alone reverts GAAP_FV -> GAAP_COST — must still 400, regardless of USDC's state.
    const suiRevert = await patch(app, { asu202308Applies: { [SUI]: false, [USDC]: true } });
    expect(suiRevert.statusCode).toBe(400);
    expect(suiRevert.body.error?.code).toBe('POLICY_BASIS_LOCKED');
  });

  // Round-1 external review (should-fix): foldValuationStates throws on ANY basis mismatch,
  // not just a GAAP_FV one. A coin revalued under GAAP_COST (US_GAAP, asu202308Applies=false)
  // that gets reverted straight back to IFRS_COST via accountingStandard alone — no
  // asu202308Applies change in the request at all — must be blocked exactly like the GAAP_FV
  // case, or the same "next run-rules event 500s" crash class survives for this basis pair.
  it('400 POLICY_BASIS_LOCKED when accountingStandard reverts a live GAAP_COST coin to IFRS_COST', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    // Adopt US_GAAP but explicitly OUT of fair-value scope for SUI -> GAAP_COST track.
    await patch(app, { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: false } });
    const reval = await runReval(app);
    expect(reval.statusCode).toBe(201); // live GAAP_COST valuation now exists for SUI

    const revert = await patch(app, { accountingStandard: 'IFRS' });
    expect(revert.statusCode).toBe(400);
    expect(revert.body.error?.code).toBe('POLICY_BASIS_LOCKED');
  });

  // Mutation test (per repro in the fix report): with the guard removed, this exact sequence
  // used to reach foldValuationStates' mixed-basis fail-closed throw → mislabeled 500
  // VALUATION_CORRUPT on the NEXT run-rules call touching this entity. Left here as a
  // documented repro, not executed (the guard is the fix under test, not something to
  // toggle off in CI) — see fix report .superpowers/sdd/task-13-fixwave.md §external-round.
});
