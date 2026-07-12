/**
 * C1 (whole-branch final review): revaluation RERUN after an intervening disposal must not
 * double-count the released revaluation delta.
 *
 * The defect: a rerun (price correction) reverses the OLD run's reval JE and supersedes its
 * lot_valuation rows, then folds a fresh baseline. Two independent bugs corrupted it once a
 * disposal had happened between the old run and the rerun:
 *   1. supersedeValuationsOfRun swept the DISPOSAL_RELEASE row too (it borrows the old run's
 *      run_id, seq>0) — a historical fact, not an estimate, got marked superseded → the new
 *      fold lost the release → prior carrying over-stated by the released delta.
 *   2. the reversal reversed the old reval JE IN FULL even for a coin FULLY disposed after
 *      that run — but the disposal had already reclassified that unrealized gain to realized,
 *      so reversing it drove DigitalAssets negative by the released amount.
 *
 * WHY this matters (Rule 9): the correctness criterion for GAAP_FV is unambiguous — after a
 * rerun at the corrected cut-off price, DigitalAssets for the coin must equal the FAIR VALUE
 * of the REMAINING holdings at that price (and never go negative). Both series assert that GL
 * invariant directly from the journal, so a regression in either fix (supersede sweep back, or
 * full-reversal-regardless-of-holdings) fails loud here. See the fix report task-13-fixwave.md
 * for the algebra proving full reversal (not a netted reversal) is correct when remaining lots
 * exist, and reversal-skip is correct when they do not.
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
const ASOF = '2026-06-30'; // period cut-off for P
const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');
const LOT = 'OPEN-open-sui';

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
  setAiSuggestion(db, id, { aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO' });
}
async function runRules(app: FastifyInstance): Promise<{ posted: number; skipped: number }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
  return r.json();
}
async function patchToGaap(app: FastifyInstance): Promise<void> {
  const r = await app.inject({ method: 'PATCH', url: '/policy/policy-set', payload: { entity: E, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } } } });
  expect(r.statusCode).toBe(200);
}
async function runReval(app: FastifyInstance): Promise<{ statusCode: number; body: { runId?: string; jeIds?: string[]; reversedRunId?: string | null } }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  return { statusCode: r.statusCode, body: r.json() };
}
async function postPriceAt(app: FastifyInstance, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}
// GL balance for one account, optionally scoped to one origCoinType (both SUI and USDC map to
// DigitalAssets — the swap's USDC-acquisition leg would otherwise pollute the SUI carrying).
// DEBIT positive, CREDIT negative: a GAAP_FV unrealized GAIN (a CREDIT to UnrealizedGain) reads
// as a negative number here.
function glBalance(db: Db, account: string, coin?: string): bigint {
  const rows = db.prepare('SELECT je_json FROM journal_entries WHERE entity_id = ?').all(E) as Array<{ je_json: string }>;
  let bal = 0n;
  for (const r of rows) {
    const je = JSON.parse(r.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; origCoinType?: string | null }> };
    for (const l of je.lines) {
      if (l.account !== account) continue;
      if (coin !== undefined && l.origCoinType !== coin) continue;
      bal += l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor);
    }
  }
  return bal;
}
interface LvRow { run_id: string; seq: number; delta_minor: string; reason: string; superseded_by: string | null }
function lvRows(db: Db): LvRow[] {
  return db_lvRows(db, LOT);
}
function db_lvRows(db: Db, lotId: string): LvRow[] {
  return db.prepare(
    'SELECT run_id, seq, delta_minor, reason, superseded_by FROM lot_valuation WHERE entity_id = ? AND lot_id = ? ORDER BY created_at',
  ).all(E, lotId) as LvRow[];
}
function reversalJe(db: Db): { lines: Array<{ account: string; side: string; amountMinor: string }> } | null {
  const row = db.prepare("SELECT je_json FROM journal_entries WHERE entity_id = ? AND idempotency_key LIKE 'reval-rev:%'").get(E) as { je_json: string } | undefined;
  return row ? JSON.parse(row.je_json) : null;
}

// Shared prelude for both series: opening lot (cost 100000, qty 100) → GAAP_FV transition run
// @ $12.00 (opening delta +20000, seq-0, equity) → period reval run @ $14.00 (delta +20000,
// P&L). Cumulative delta 40000, carrying 140000.
async function seedThroughTwoRevals(app: FastifyInstance & { _db: Db }): Promise<void> {
  seedAuto(app._db, 'open-sui', opening());
  await runRules(app);
  await patchToGaap(app);
  await postPriceAt(app, SUI, ASOF, '12.00');
  expect((await runReval(app)).statusCode).toBe(201);
  await postPriceAt(app, SUI, ASOF, '14.00');
  expect((await runReval(app)).statusCode).toBe(201);
  expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(140000n);
}

describe('C1 (final review): revaluation rerun after an intervening disposal', () => {
  it('series A — partial disposal (50%) then rerun @ corrected price: DigitalAssets equals fair value of the REMAINING holdings; release row survives; old reval reversed in full', async () => {
    const app = await freshApp();
    await seedThroughTwoRevals(app);

    // Dispose HALF (50 of 100 SUI). Carrying disposed = 50% of 140000 = 70000.
    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap({ quantityMinor: '50', considerationQtyMinor: '75000' }));
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(70000n); // 140000 - 70000

    const run2 = lvRows(app._db).find((r) => r.reason === 'REVALUE')!.run_id;

    // Rerun with the CORRECTED cut-off price $16.00 → remaining 50 qty fair value = 50*1600 = 80000.
    await postPriceAt(app, USDC, ASOF, '0.01'); // USDC now held (swap consideration) — needs a cut-off price too
    await postPriceAt(app, SUI, ASOF, '16.00');
    const rr = await runReval(app);
    expect(rr.statusCode).toBe(201);
    const run3 = rr.body.runId!;

    // THE invariant: DigitalAssets(SUI) == fair value of remaining holdings at the corrected
    // price. Regression #1 (release swept by supersede) lands 60000 here (off by the released
    // 20000).
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(80000n);
    // Unrealized gain on the remaining lot: FV 80000 − opening baseline (cost 50000 + opening
    // 10000 = 60000) = 20000 gain (a CREDIT, hence −20000 in debit-positive terms). Unfiltered
    // by coin: the disposal's UNREALIZED_GAIN_RECLASS leg carries origCoinType=null, and only
    // SUI (GAAP_FV) ever touches this account here.
    expect(glBalance(app._db, 'UnrealizedGainCryptoPnL')).toBe(-20000n);

    // The old reval JE was reversed IN FULL (20000 — the whole run2 period delta), NOT netted
    // down by the released share. Full reversal is correct precisely because the fresh reval
    // that follows re-establishes carrying from the fold.
    const rev = reversalJe(app._db)!;
    const revDa = rev.lines.find((l) => l.account === 'DigitalAssets')!;
    expect(revDa).toMatchObject({ side: 'CREDIT', amountMinor: '20000' });

    const rows = lvRows(app._db);
    // Fix #2: the DISPOSAL_RELEASE row (a historical fact) is NEVER superseded by the rerun.
    const release = rows.find((r) => r.reason === 'DISPOSAL_RELEASE')!;
    expect(release.delta_minor).toBe('-20000');
    expect(release.superseded_by).toBeNull();
    // The run2 REVALUE row, by contrast, IS superseded by run3 (proves the exclusion is
    // reason-scoped, not a blanket "never supersede this run").
    const oldReval = rows.find((r) => r.reason === 'REVALUE' && r.run_id === run2)!;
    expect(oldReval.superseded_by).toBe(run3);
    // seq-0 opening row stays permanent.
    expect(rows.find((r) => r.reason === 'OPENING_FV')!.superseded_by).toBeNull();
  });

  it('series B — full disposal then rerun @ corrected price: DigitalAssets settles to 0 (never negative); the fully-disposed coin is NOT reversed (its gain was already realized)', async () => {
    const app = await freshApp();
    await seedThroughTwoRevals(app);

    // Dispose ALL 100 SUI. Carrying disposed = 140000 → DigitalAssets(SUI) back to 0.
    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap());
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(0n);

    await postPriceAt(app, USDC, ASOF, '0.01');
    await postPriceAt(app, SUI, ASOF, '16.00');
    const rr = await runReval(app);
    expect(rr.statusCode).toBe(201);

    // THE invariant: no remaining SUI → DigitalAssets(SUI) stays exactly 0, NEVER negative.
    // The buggy full-reversal path lands −20000 here (reverses run2's reval even though the
    // disposal already reclassified that gain to realized).
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(0n);

    // No reversal JE at all for the fully-disposed coin: nothing on the books to reverse.
    expect(reversalJe(app._db)).toBeNull();
    // The rerun still opened a run, but it emitted no JEs (nothing to reval, nothing to reverse).
    expect(rr.body.jeIds).toEqual([]);

    // The full-disposal release row (−40000) also survives, unsuperseded.
    const release = lvRows(app._db).find((r) => r.reason === 'DISPOSAL_RELEASE')!;
    expect(release.delta_minor).toBe('-40000');
    expect(release.superseded_by).toBeNull();
  });

  it('series C — full disposal then same-coin RE-ACQUIRE (new lot) then rerun @ corrected price: DigitalAssets equals the FRESH fair value of the new lot only; the old fully-disposed lot is NOT reversed even though the coin is held again', async () => {
    const app = await freshApp();
    await seedThroughTwoRevals(app);

    // Dispose ALL 100 SUI — lot A (OPEN-open-sui) is fully gone. DA(SUI) → 0.
    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap());
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(0n);

    // Re-acquire SUI as a BRAND-NEW lot (cost 100000, qty 100) AFTER the disposal. This lot was
    // never valued by run2. The coin SUI returns to heldCoins — exactly the coin-level trap: a
    // per-coin reversal decision would now reverse run2's reval for the DISPOSED lot A.
    seedAuto(app._db, 'open-sui-2', opening({ eventId: 'open-sui-2', quantityMinor: '100', openingCostMinor: '100000', eventTime: '2026-06-20T00:00:00Z' }));
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(100000n); // new lot at cost, no reval yet

    await postPriceAt(app, USDC, ASOF, '0.01');
    await postPriceAt(app, SUI, ASOF, '16.00');
    const rr = await runReval(app);
    expect(rr.statusCode).toBe(201);

    // THE invariant (Rule 9): DA(SUI) = FRESH reval of the new lot only = 100 * 1600 = 160000.
    // The old run2 reval belonged to the fully-disposed lot A (its unrealized gain was already
    // reclassified to realized on disposal) — nothing on the books to reverse. Coin-level
    // heldCoins reverses run2 in full (−20000) and silently lands 140000, dropping R2.
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(160000n);
    expect(glBalance(app._db, 'UnrealizedGainCryptoPnL')).toBe(-60000n); // fresh gain 160000-100000 on new lot

    // No reversal JE at all: the only old-run-valued lot (A) is fully disposed.
    expect(reversalJe(app._db)).toBeNull();

    // The new run emitted exactly one fresh reval JE (no reversal).
    expect(rr.body.jeIds!.length).toBe(1);
  });

  // Series D shared setup: two SUI lots (A=OPEN-open-sui, B=OPEN-open-sui-b), each cost 100000 /
  // qty 100. Transition @ $12, period reval @ $14 (both lots valued by run2). Dispose lot A FULLY
  // (FIFO consumes the earliest lot). Rerun @ corrected $16 with lot B surviving.
  async function seedTwoLotsDisposeOneThenRerun(app: FastifyInstance & { _db: Db }): Promise<{ run2: string; run3: string }> {
    seedAuto(app._db, 'open-sui', opening());
    seedAuto(app._db, 'open-sui-b', opening({ eventId: 'open-sui-b', quantityMinor: '100', openingCostMinor: '100000', eventTime: '2026-04-02T00:00:00Z', txDigest: 'DIGB', rawPayloadHash: 'beefb', eventIndex: 1 }));
    await runRules(app);
    await patchToGaap(app);
    await postPriceAt(app, SUI, ASOF, '12.00');
    expect((await runReval(app)).statusCode).toBe(201);
    await postPriceAt(app, SUI, ASOF, '14.00');
    expect((await runReval(app)).statusCode).toBe(201);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(280000n); // 2 * (100000+20000+20000)
    const run2 = lvRows(app._db).find((r) => r.reason === 'REVALUE')!.run_id;

    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap());          // dispose lot A fully
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(140000n); // 280000 − lot A carrying 140000

    await postPriceAt(app, USDC, ASOF, '0.01');
    await postPriceAt(app, SUI, ASOF, '16.00');
    const rr = await runReval(app);
    expect(rr.statusCode).toBe(201);
    return { run2, run3: rr.body.runId! };
  }

  it('series D (decision regression guard) — two old lots of the same coin, one FULLY disposed: the SURVIVING sibling keeps the coin in the reversal set (reversal fires; disposed lot superseded; its release survives)', async () => {
    // This is the mutation guard for the lot-level DECISION: a naive "skip if any lot of this
    // coin was disposed" would wrongly drop lot B's reversal → reversalJe null here. It asserts
    // ONLY the decision + supersession bookkeeping, NOT the coin-aggregate reversal AMOUNT (see
    // the it.fails below — the amount is a separate, pre-existing defect out of this fix's scope).
    const app = await freshApp();
    const { run2, run3 } = await seedTwoLotsDisposeOneThenRerun(app);

    // Coin stayed in the reversal set because lot B (an old-run-valued lot) survives.
    expect(reversalJe(app._db)).not.toBeNull();
    // Lot A (disposed) run2 REVALUE row is superseded by run3; lot A's release row survives.
    const aRows = db_lvRows(app._db, 'OPEN-open-sui');
    expect(aRows.find((r) => r.reason === 'REVALUE' && r.run_id === run2)!.superseded_by).toBe(run3);
    expect(aRows.find((r) => r.reason === 'DISPOSAL_RELEASE')!.superseded_by).toBeNull();
    // Lot B got a fresh reval row under run3.
    const bRows = db_lvRows(app._db, 'OPEN-open-sui-b');
    expect(bRows.find((r) => r.reason === 'REVALUE' && r.run_id === run3)).toBeTruthy();
  });

  // KNOWN GAP (surfaced by this fix, NOT closed by it — see task-13-fixwave.md §"series D finding").
  // The lot-level DECISION is correct (coin reversed because lot B survives), but the reversal
  // AMOUNT is the OLD run's COIN-AGGREGATE reval JE (both lots, 40000). Reversing lot A's 20000
  // share double-counts: the disposal already reclassified lot A's unrealized gain to realized.
  // Unlike series A (single lot, partial disposal — the release row lives on the SAME surviving
  // lot and compensates in-fold), lot A's release lives on the disposed lot and never enters lot
  // B's fold, so nothing compensates. Result: DA(SUI)=140000, understating the true fair value of
  // the surviving lot B (160000) by lot A's over-reversed 20000. The correct fix needs a per-LOT
  // reversal amount (reverse only surviving lots' shares), which requires re-deriving the JE from
  // per-lot deltas at the engine level — beyond this task's surgical scope. Encoded as an
  // expected-fail so the TRUE invariant is on record and the suite stays honestly green.
  it.fails('series D (amount) — DA must equal the surviving lot fair value (160000); currently 140000 due to coin-aggregate over-reversal [KNOWN GAP, expected-fail]', async () => {
    const app = await freshApp();
    await seedTwoLotsDisposeOneThenRerun(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(160000n); // TRUE invariant; currently 140000
  });
});
