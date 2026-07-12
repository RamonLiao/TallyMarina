/**
 * Task 10 (spec §4.5, CPA B1): disposal of a GAAP_FV-revalued lot consumes the REVALUED
 * carrying, not raw FIFO cost — end-to-end through two real revaluation runs (so the
 * cumulative delta accrues across both a transition-sourced piece and a period-P&L piece,
 * exactly as it would in production) followed by a run-rules disposal (SPOT_TRADE_SWAP).
 *
 * WHY this test matters (Rule 9): the engine-level unit test (disposal.revalued.test.ts)
 * pins the CPA B1 arithmetic in isolation. This test pins the WIRING — that lotsForEvent
 * actually folds lot_valuation into the lots the engine sees, and that routes.ts actually
 * writes the DISPOSAL_RELEASE row so a lot fully disposed doesn't leave a phantom
 * cumulativeDeltaMinor behind to corrupt a hypothetical future re-revaluation of the same
 * lot id. Skipping either wiring point silently reverts to CPA B1's original bug (disposal
 * ignores the revaluation) while the isolated unit test keeps passing.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { canonicalCoinType } from '../src/assets/normalize.js';

const E = 'e1';
const P = '2026-Q2';
const ASOF = '2026-06-30'; // period cut-off for P (pricePointStore.PERIOD_CUTOFFS)
const SUI = '0x2::sui::SUI';
// p06_pricefx.ts (used for the swap's consideration-asset FV) matches price rows to the
// event's coinType by EXACT string equality — no canonicalization at engine level (unlike
// orchestrate.ts's revaluation read path, which canonicalizes both sides). POST /prices
// canonicalizes on write, so the event payload must carry the SAME canonical form or the
// FV lookup 400s PRICE_MISSING even though a price row exists (buildRuleInput.prices.test.ts
// documents this exact gap).
const USDC = canonicalCoinType('0xbeef::usdc::USDC');

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
    assetDecimals: 0, quantityMinor: '100', eventTime: '2026-06-15T00:00:00Z',
    economicPurpose: 'SPOT_TRADE_SWAP', ownershipChange: true,
    considerationAsset: USDC, considerationQtyMinor: '150000', considerationDecimals: 0,
    rawPayloadHash: 'swphash', txDigest: 'DIGSWP', eventIndex: 0, ...over,
  };
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  registerTestAsset(app._db, E, SUI, 0);
  registerTestAsset(app._db, E, USDC, 0);
  return app;
}

function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

async function runRules(app: FastifyInstance): Promise<{ posted: number; skipped: number }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
  return r.json();
}

async function patchToGaap(app: FastifyInstance): Promise<void> {
  const r = await app.inject({
    method: 'PATCH', url: '/policy/policy-set',
    payload: { entity: E, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } } },
  });
  expect(r.statusCode).toBe(200);
}

async function runReval(app: FastifyInstance): Promise<{ statusCode: number; body: { runId?: string } }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  return { statusCode: r.statusCode, body: r.json() };
}

// Route-based price insertion (not a direct store call): POST /prices canonicalizes coinType
// on write (orchestrate.ts reads back via the SAME canonicalization) — a raw insertPricePoint
// call here would persist the short-form coinType and silently mismatch at read time.
async function postPriceAt(app: FastifyInstance, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}

function jeLines(db: Db, eventId: string): Array<{ account: string; side: string; amountMinor: string; leg?: string }> {
  const rows = db.prepare('SELECT je_json FROM journal_entries WHERE event_id = ?').all(eventId) as Array<{ je_json: string }>;
  return rows.flatMap((r) => (JSON.parse(r.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; leg?: string }> }).lines);
}

interface LvRow { lot_id: string; delta_minor: string; reason: string; superseded_by: string | null; je_id: string | null; qty_minor: string }
function lvRows(db: Db, lotId: string): LvRow[] {
  return db.prepare(
    'SELECT lot_id, delta_minor, reason, superseded_by, je_id, qty_minor FROM lot_valuation WHERE entity_id = ? AND lot_id = ? ORDER BY created_at',
  ).all(E, lotId) as LvRow[];
}

describe('§4.5 (CPA B1, Task 10): run-rules disposal consumes revalued GAAP_FV carrying', () => {
  it('two reval runs accrue cumulativeDelta=40000 (cost 100000→carrying 140000); full disposal at 150000 reclasses it, JE Cr DigitalAssets 140000, DISPOSAL_RELEASE zeroes the fold', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await patchToGaap(app);

    // Run 1 (entity's first GAAP_FV run for this lot): 100 qty @ $12.00 = value 120000 vs
    // cost 100000 → transition delta +20000 (Dr DigitalAssets / Cr RetainedEarnings, seq-0,
    // NOT P&L).
    await postPriceAt(app, SUI, ASOF, '12.00');
    const r1 = await runReval(app);
    expect(r1.statusCode).toBe(201);

    // Run 2 (period reval from the opening baseline): 100 qty @ $14.00 = value 140000 vs
    // opening 120000 → period delta +20000, booked to UnrealizedGainCryptoPnL (real P&L
    // this time).
    await postPriceAt(app, SUI, ASOF, '14.00');
    const r2 = await runReval(app);
    expect(r2.statusCode).toBe(201);

    const lotId = 'OPEN-open-sui';
    const beforeDisposal = lvRows(app._db, lotId).filter((r) => r.superseded_by === null);
    const cumDeltaBefore = beforeDisposal.reduce((s, r) => s + BigInt(r.delta_minor), 0n);
    expect(cumDeltaBefore).toBe(40000n); // 20000 (transition) + 20000 (period) — matches CPA B1 carrying 140000

    // Full disposal: sell all 100 SUI for 150000 USDC (considerationQtyMinor, decimals=0).
    // Consideration FV needs its own price at the swap's OWN event date (not the reval cutoff).
    await postPriceAt(app, USDC, '2026-06-15', '0.01'); // 150000 qty * $0.01 = FV 150000
    seedAuto(app._db, 'swp1', swap());
    const rr = await runRules(app);
    expect(rr.posted).toBeGreaterThan(0);
    expect(rr.skipped).toBe(0);

    const lines = jeLines(app._db, 'swp1');
    const disp = lines.find((l) => l.leg === 'DISPOSAL');
    expect(disp).toMatchObject({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '140000' }); // cost+cumDelta, not raw cost 100000

    const mainGain = lines.find((l) => l.leg === 'DISPOSAL_GAIN');
    expect(mainGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '10000' }); // 150000-140000

    // external-review fix: reclass is the P&L-ONLY portion (run2's period delta, 20000) —
    // NOT the full 40000 cumulative delta. Run1's 20000 was booked straight to RetainedEarnings
    // (equity, via the ASU-transition JE) and must never pass through UnrealizedGainCryptoPnL.
    const reclassUnreal = lines.find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS');
    expect(reclassUnreal).toMatchObject({ account: 'UnrealizedGainCryptoPnL', side: 'DEBIT', amountMinor: '20000' });
    const reclassGain = lines.find((l) => l.leg === 'DISPOSAL_GAIN_RECLASS');
    expect(reclassGain).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '20000' });

    // DisposalGain nets to 30000 (10000 main + 20000 reclass), NOT 50000 (proceeds - original
    // cost) — the equity-sourced 20000 from run1's transition was already recognized in
    // RetainedEarnings by that (separate) JE and correctly never touches DisposalGain.
    const disposalGainTotal = lines
      .filter((l) => l.account === 'DisposalGain')
      .reduce((s, l) => s + (l.side === 'CREDIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)), 0n);
    expect(disposalGainTotal).toBe(30000n);

    // The run1 transition JE's RetainedEarnings credit (20000) is untouched by disposal —
    // proves the equity portion was never recycled through P&L a second time.
    const retainedEarningsRow = app._db.prepare(
      `SELECT je_json FROM journal_entries WHERE idempotency_key LIKE 'reval-open:%'`,
    ).get() as { je_json: string };
    const retainedLine = (JSON.parse(retainedEarningsRow.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string }> })
      .lines.find((l) => l.account === 'RetainedEarnings');
    expect(retainedLine).toMatchObject({ side: 'CREDIT', amountMinor: '20000' });

    // DISPOSAL_RELEASE row: written, qty = consumed qty, delta = -40000 (releases the full
    // cumulative delta since this was a FULL disposal), points at the disposal JE.
    const afterDisposal = lvRows(app._db, lotId);
    const releaseRow = afterDisposal.find((r) => r.reason === 'DISPOSAL_RELEASE');
    expect(releaseRow).toBeTruthy();
    expect(releaseRow).toMatchObject({ qty_minor: '100', delta_minor: '-40000' });
    expect(releaseRow!.je_id).toBeTruthy();
    const disposalJeRow = app._db.prepare('SELECT id FROM journal_entries WHERE event_id = ? LIMIT 1').get('swp1') as { id: string };
    expect(releaseRow!.je_id).toBe(disposalJeRow.id);

    // Fold after disposal: cumulativeDelta for this lot is now exactly 0 (release cancels
    // the prior +40000) — a hypothetical future re-revaluation of this same lot id would see
    // a clean baseline, not a phantom +40000 for quantity that no longer exists.
    const afterUnsuperseded = afterDisposal.filter((r) => r.superseded_by === null);
    const cumDeltaAfter = afterUnsuperseded.reduce((s, r) => s + BigInt(r.delta_minor), 0n);
    expect(cumDeltaAfter).toBe(0n);
  });

  it('no revaluation ever run → disposal behaves exactly as pre-Task-10 (byte-identical regression lock): no reclass lines, no DISPOSAL_RELEASE row', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    // No revaluation run at all — lot never carries valuationDeltaMinor.

    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap());
    const rr = await runRules(app);
    expect(rr.posted).toBeGreaterThan(0);

    const lines = jeLines(app._db, 'swp1');
    expect(lines.find((l) => l.leg === 'DISPOSAL')).toMatchObject({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '100000' });
    expect(lines.find((l) => l.leg === 'DISPOSAL_GAIN')).toMatchObject({ account: 'DisposalGain', side: 'CREDIT', amountMinor: '50000' }); // 150000-100000
    expect(lines.some((l) => (l.leg ?? '').includes('RECLASS'))).toBe(false);

    const releaseRows = app._db.prepare(
      "SELECT 1 FROM lot_valuation WHERE entity_id = ? AND lot_id = 'OPEN-open-sui' AND reason = 'DISPOSAL_RELEASE'",
    ).all(E);
    expect(releaseRows).toHaveLength(0);
  });

  it('two partial-disposal events draining the SAME lot under the SAME still-current run/seq do not collide on lot_valuation id (dual-review finding)', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await patchToGaap(app);
    // Single reval run: value 120000 vs cost 100000 → transition delta +20000 (seq-0).
    await postPriceAt(app, SUI, ASOF, '12.00');
    expect((await runReval(app)).statusCode).toBe(201);

    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    // Two separate swap events, each disposing HALF (50/100) of the same lot, in one run-rules pass.
    seedAuto(app._db, 'swpA', swap({
      eventId: 'swpA', quantityMinor: '50', considerationQtyMinor: '75000',
      txDigest: 'DIGSWPA', eventTime: '2026-06-15T00:00:00Z',
    }));
    seedAuto(app._db, 'swpB', swap({
      eventId: 'swpB', quantityMinor: '50', considerationQtyMinor: '75000',
      txDigest: 'DIGSWPB', eventTime: '2026-06-15T00:00:01Z',
    }));
    const rr = await runRules(app);
    expect(rr.posted).toBeGreaterThan(0);
    expect(rr.skipped).toBe(0);

    const lotId = 'OPEN-open-sui';
    const releaseRows = lvRows(app._db, lotId).filter((r) => r.reason === 'DISPOSAL_RELEASE');
    expect(releaseRows).toHaveLength(2); // NOT deduped/collided into 1
    const ids = app._db.prepare(
      "SELECT id FROM lot_valuation WHERE entity_id = ? AND lot_id = ? AND reason = 'DISPOSAL_RELEASE'",
    ).all(E, lotId) as Array<{ id: string }>;
    expect(new Set(ids.map((r) => r.id)).size).toBe(2); // distinct ids

    // Both releases attributed correctly (10000 + 10000 = full 20000 delta), each tagged
    // with ITS OWN disposal JE (not sharing one je_id across the two events).
    const totalReleased = releaseRows.reduce((s, r) => s + (-BigInt(r.delta_minor)), 0n);
    expect(totalReleased).toBe(20000n);
    const jeIds = new Set(releaseRows.map((r) => r.je_id));
    expect(jeIds.size).toBe(2);

    // Fold: cumulativeDelta fully released after both partial disposals drain the lot to 0.
    const cumDeltaAfter = lvRows(app._db, lotId).filter((r) => r.superseded_by === null)
      .reduce((s, r) => s + BigInt(r.delta_minor), 0n);
    expect(cumDeltaAfter).toBe(0n);
  });
});
