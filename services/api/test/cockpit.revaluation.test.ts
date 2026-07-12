/**
 * Task 7 (spec D12/D13): cockpit revaluation light — the 'stale' state, replacing the mock
 * 'pricing' light.
 *
 * WHY these tests matter (Rule 9):
 * - "no run yet" and "current position has a blocking PRICE_MISSING" must both red the light:
 *   blocking-fact authority is the revaluation run/gate itself (orchestrate.ts), the light is
 *   only a projection of it — it must never invent its own looser notion of "OK".
 * - "stale" is a DUAL fingerprint check (priceSetHash AND lotSetHash), not just "a run exists".
 *   A period whose price set changed (re-price) or whose lot set changed (a new lot on an
 *   ALREADY-PRICED coin — no price change at all) must both show stale, because in both cases
 *   the persisted run no longer reflects the current position. The lotSetHash half is the
 *   linchpin (spec §10): drop that comparison and a same-price new lot silently reads GREEN,
 *   which is exactly the "revalued a stale position and called it current" bug this light
 *   exists to prevent.
 * - stale must actually block /period/lock (closeable requires every non-mock light green;
 *   'stale' is neither mock nor green) — the light is worthless if the gate doesn't read it.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { buildCockpit, type Light } from '../src/periodLock/cockpit.js';
import { canonicalCoinType } from '../src/assets/normalize.js';

const E = 'e1';
const P = '2026-Q2';
const ASOF = '2026-06-30';
const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');

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
  return app;
}

function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

async function runRules(app: FastifyInstance): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
}

async function postPrice(app: FastifyInstance, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType: SUI, asOf: ASOF, price } });
  expect(r.statusCode).toBe(201);
}

async function postPriceAt(app: FastifyInstance, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}

function swap(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'swp1', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '500000000', eventTime: '2026-06-15T00:00:00Z',
    economicPurpose: 'SPOT_TRADE_SWAP', ownershipChange: true,
    considerationAsset: USDC, considerationQtyMinor: '2500', considerationDecimals: 0,
    rawPayloadHash: 'swphash', txDigest: 'DIGSWP', eventIndex: 0, ...over,
  };
}

async function runReval(app: FastifyInstance): Promise<{ statusCode: number; body: { runId?: string } }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  return { statusCode: r.statusCode, body: r.json() };
}

function revaluationLightOf(db: Db): Light {
  const cockpit = buildCockpit(db, E, P, 0.7);
  return cockpit.lights.find((l) => l.key === 'revaluation')!;
}

describe('cockpit revaluation light (Task 7)', () => {
  it('no run yet → red, and closeable is false even though every other light is green', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00'); // priced, but no run posted yet

    const cockpit = buildCockpit(app._db, E, P, 0.7);
    const revaluation = cockpit.lights.find((l) => l.key === 'revaluation')!;
    expect(revaluation.status).toBe('red');
    expect(revaluation.real).toBe(true);
    expect(revaluation.label).toBe('Revaluation');
    // Every OTHER real light is green — proves closeable=false traces to revaluation alone.
    for (const l of cockpit.lights) {
      if (l.key === 'revaluation' || l.status === 'mock') continue;
      expect(l.status).toBe('green');
    }
    expect(cockpit.closeable).toBe(false);
  });

  it('a blocking PRICE_MISSING position → red even with a prior run on record', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    const first = await runReval(app);
    expect(first.statusCode).toBe(201);
    expect(revaluationLightOf(app._db).status).toBe('green');

    // Register a second coin the entity now holds but never prices — priceMissing kicks in
    // even though a (now-stale-by-lots) prior run exists.
    registerTestAsset(app._db, E, '0xbeef::usdc::USDC', 6);
    seedAuto(app._db, 'open-usdc', opening({
      eventId: 'open-usdc', coinType: '0xbeef::usdc::USDC', assetDecimals: 6,
      quantityMinor: '2000000', openingCostMinor: '200000',
      txDigest: 'DIGUSDC', eventTime: '2026-04-02T00:00:00Z',
    }));
    await runRules(app);

    expect(revaluationLightOf(app._db).status).toBe('red');
  });

  it('run posted with current prices/lots → green', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    const r = await runReval(app);
    expect(r.statusCode).toBe(201);

    expect(revaluationLightOf(app._db).status).toBe('green');
  });

  it('re-price after a run (priceSetHash changes) → stale', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    expect((await runReval(app)).statusCode).toBe(201);
    expect(revaluationLightOf(app._db).status).toBe('green');

    await postPrice(app, '6000.00'); // append-only: new price supersedes the old one at read time
    expect(revaluationLightOf(app._db).status).toBe('stale');
  });

  // linchpin (spec §10): a new lot on the SAME already-priced coin changes lotSetHash while
  // priceSetHash stays byte-identical. If the light only compared priceSetHash, this would
  // read GREEN — a stale run masquerading as current.
  it('new lot on the same coin, no price change (lotSetHash changes) → still stale', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    const first = await runReval(app);
    expect(first.statusCode).toBe(201);
    expect(revaluationLightOf(app._db).status).toBe('green');

    // Same coin, same price already on file — only the lot set grows.
    seedAuto(app._db, 'open-sui-2', opening({
      eventId: 'open-sui-2', quantityMinor: '2000000000', openingCostMinor: '1000000',
      txDigest: 'DIG2', eventTime: '2026-04-03T00:00:00Z',
    }));
    await runRules(app);

    expect(revaluationLightOf(app._db).status).toBe('stale');
  });

  // I1 (final-review): a disposal shrinks a held lot's remaining qty → lotSetHash changes with
  // no price/policy change at all → the run on record no longer reflects the current position →
  // stale. This is the same linchpin as "new lot, same price" but via the OTHER direction of a
  // lot-set mutation (consumption, not accretion), which is the common real-world trigger.
  it('post a disposal after a green run (lot qty shrinks) → stale', async () => {
    const app = await freshApp();
    registerTestAsset(app._db, E, USDC, 0);
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    expect((await runReval(app)).statusCode).toBe(201);
    expect(revaluationLightOf(app._db).status).toBe('green');

    // Dispose HALF the SUI for USDC. Price USDC at BOTH the swap date (consideration FV) and the
    // period cut-off (so the newly-held USDC is not itself PRICE_MISSING — that would red the
    // light for a different reason and mask the lotSetHash-stale signal under test).
    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    await postPriceAt(app, USDC, ASOF, '0.01');
    seedAuto(app._db, 'swp1', swap());
    await runRules(app);

    expect(revaluationLightOf(app._db).status).toBe('stale');
  });

  it('stale blocks POST /period/lock (409 LIGHTS_NOT_GREEN naming the revaluation light)', async () => {
    const app = await freshApp();
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    await postPrice(app, '5000.00');
    expect((await runReval(app)).statusCode).toBe(201);
    // Stale it via a same-coin new lot (mirrors the linchpin case above).
    seedAuto(app._db, 'open-sui-2', opening({
      eventId: 'open-sui-2', quantityMinor: '2000000000', openingCostMinor: '1000000',
      txDigest: 'DIG2', eventTime: '2026-04-03T00:00:00Z',
    }));
    await runRules(app);
    expect(revaluationLightOf(app._db).status).toBe('stale');

    const lockR = await app.inject({ method: 'POST', url: `/entities/${E}/period/lock`, payload: { periodId: P } });
    expect(lockR.statusCode).toBe(409);
    const body = lockR.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('LIGHTS_NOT_GREEN');
    expect(body.error.message).toContain('revaluation');
  });

  // External review (should-fix): PERIOD_CUTOFFS used to be a hard-coded table with only
  // 2026-Q2 in it, so periodCutoff('2026-Q3') threw and this catch block turned it into a
  // permanently-red light with no way to ever go green (not even "no run yet" red — a
  // swallowed-exception red, indistinguishable from a real one). Now that periodCutoff is a
  // pure quarter computation, a period with no run yet reds for the LEGITIMATE reason (no
  // run on record), same as the Q2 case above, not because the light's own lookup threw.
  it('a non-Q2 period with no run reds for "no run yet", not a swallowed periodCutoff throw', async () => {
    const app = await freshApp();
    const cockpit = buildCockpit(app._db, E, '2026-Q3', 0.7);
    const revaluation = cockpit.lights.find((l) => l.key === 'revaluation')!;
    expect(revaluation.status).toBe('red');
    expect(revaluation.real).toBe(true);
    expect(revaluation.label).toBe('Revaluation');
  });
});
