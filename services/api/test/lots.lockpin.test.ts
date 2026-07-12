/**
 * Task 6 (C4 lot store) — locked-period pin (spec §1).
 *
 * Once a period is closed its lot movements are HISTORY: they are the pinned cost basis that
 * later periods draw down. Changing today's effective policy (here, the DEMO unit price) must
 * NOT rewrite those persisted rows, and a subsequent period's FIFO consume must continue from
 * the PINNED remaining basis — never from a freshly re-simulated world at the new price.
 *
 * We prove three things:
 *   (a) GET /lots surfaces DRIFT objects — the recompute-on-read replays at the NEW price and
 *       honestly reports that it diverges from the persisted (old-price) basis;
 *   (b) the persisted lot_movement rows are BYTE-IDENTICAL before and after the price change;
 *   (c) run-rules for the NEXT period folds from the PERSISTED movements: the disposal consumes
 *       the pinned old-price cost, not the doubled new-price cost a re-simulation would produce.
 *
 * Price control: buildRuleInput hardcodes unitPriceMinor. We mock the module to read a mutable
 * hoisted holder so we can post period P at price 100, then flip to 200 and observe that only
 * the RECOMPUTE (simulate) moves — the persisted ledger is pinned.
 *
 * Lock mechanism: we lock via the period_lock STORE (lockPeriod) to isolate the pin invariant.
 * The route's server-side green-gate (LIGHTS_NOT_GREEN etc.) is covered by
 * periodLock/routes.periodLock.test.ts; here the lock exists only to set the scene and prove
 * run-rules honors it (PERIOD_LOCKED). The pin itself does not depend on HOW P got locked.
 */
import { describe, it, expect, vi } from 'vitest';

const priceHolder = vi.hoisted(() => ({ unit: '100' }));
vi.mock('../src/http/buildRuleInput.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/http/buildRuleInput.js')>();
  return {
    buildRuleInput: (event: Parameters<typeof actual.buildRuleInput>[0], opts: Parameters<typeof actual.buildRuleInput>[1]) => {
      const ri = actual.buildRuleInput(event, opts);
      // Override the demo price at call-time so the same code path can post at 100 then
      // recompute at 200. Both routes.ts (run-rules) and simulate.ts import this module.
      return { ...ri, prices: ri.prices.map((p) => ({ ...p, unitPriceMinor: priceHolder.unit })) };
    },
  };
});

import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { listLotMovements } from '../src/store/lotMovementStore.js';
import { lockPeriod, getPeriodLock } from '../src/periodLock/store.js';
import { insertPricePoint } from '../src/store/pricePointStore.js';

const E = 'e1';
const P = '2026-Q2';
const P_NEXT = '2026-Q3';
const SUI = '0x2::sui::SUI';

interface RawOver { [k: string]: unknown }
function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-05-10T00:00:00Z',
    economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function receipt(over: RawOver = {}): RawOver { return baseEvent(over); }
function payment(over: RawOver = {}): RawOver {
  // Distinct txDigest from the receipt: the movement row id/idempotency key derive from the
  // posting event's own digest, so reusing 'DIG' would collide the consume row with the acquire.
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', txDigest: 'DIGPAY', ...over });
}
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}
async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  // D14: real price_points rows for both event dates in this test — the buildRuleInput.js
  // mock above OVERRIDES the resulting unitPriceMinor at call-time, so the seeded value
  // here is irrelevant; what matters is that a row exists so pricesForEvent doesn't return
  // an empty array (which would PRICE_MISSING before the mock ever runs).
  insertPricePoint(app._db, {
    entityId: E, coinType: SUI, asOf: '2026-05-10',
    priceMinor: '1', quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
  });
  insertPricePoint(app._db, {
    entityId: E, coinType: SUI, asOf: '2026-08-15',
    priceMinor: '1', quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
  });
  return app;
}

interface LotsBody {
  simulationGaps: string[];
  groups: Array<{ lots: Array<{ lotId: string; costMinor: string; origin: string; drift: null | { recomputed: { qtyMinor: string; costMinor: string }; persisted: { qtyMinor: string; costMinor: string } } }> }>;
}

describe('locked-period pin: persisted basis is immutable, P+1 folds from it (C4 Task 6, spec §1)', () => {
  it('price change after lock drifts the read, pins the persisted rows, and P+1 consumes the pinned cost', async () => {
    priceHolder.unit = '100'; // reset — vitest reuses the module across tests in the file
    const app = await freshApp();
    const db = app._db;

    // --- Period P: post a single receipt acquire at price 100. Its cost basis is PINNED. ---
    seedAuto(db, 'r1', receipt({ eventId: 'r1', quantityMinor: '1000000000', eventTime: '2026-05-10T00:00:00Z' }));
    const rrP = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rrP.statusCode).toBe(200);

    const acquire = listLotMovements(db, E).find((m) => !m.deltaQtyMinor.startsWith('-'))!;
    const pinnedCost = BigInt(acquire.deltaCostMinor);
    expect(pinnedCost > 0n).toBe(true);
    const lotId = acquire.lotId;

    // Snapshot the persisted ledger as a byte-string (all columns, ordered) for the pin proof.
    const snapshot = JSON.stringify(db.prepare('SELECT * FROM lot_movement ORDER BY id').all());

    // --- Lock P (store-level; see file header) and prove run-rules now rejects P. ---
    lockPeriod(db, { entityId: E, periodId: P, lightsSnapshot: '{}', lockedBy: 'test', now: Date.now() });
    expect(getPeriodLock(db, E, P).status).toBe('LOCKED');
    const relock = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(relock.statusCode).toBe(409);
    expect((relock.json() as { error: { code: string } }).error.code).toBe('PERIOD_LOCKED');

    // --- Change effective policy: DEMO price 100 → 200. Lot math WOULD now differ. ---
    priceHolder.unit = '200';

    // (a) GET /lots recomputes at the NEW price → drift object with BOTH sides visible.
    const r1 = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r1.statusCode).toBe(200);
    const body = r1.json() as LotsBody;
    expect(body.simulationGaps).toEqual([]); // clean replay — the drift is real, not a gap
    const lot = body.groups.flatMap((g) => g.lots).find((l) => l.lotId === lotId)!;
    expect(lot.drift).not.toBeNull();
    // persisted side is the pinned old-price basis; recompute is the new-price world.
    expect(BigInt(lot.drift!.persisted.costMinor)).toBe(pinnedCost);
    expect(BigInt(lot.drift!.recomputed.costMinor)).not.toBe(pinnedCost);
    expect(lot.costMinor).toBe(pinnedCost.toString()); // the folded (persisted) value, not the recompute

    // (b) Persisted rows are byte-identical before and after the read + price change.
    expect(JSON.stringify(db.prepare('SELECT * FROM lot_movement ORDER BY id').all())).toBe(snapshot);

    // --- Period P+1: a disposal that fully consumes the pinned lot. ---
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', quantityMinor: '1000000000', eventTime: '2026-08-15T00:00:00Z' }));
    const rrNext = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P_NEXT } });
    expect(rrNext.statusCode).toBe(200);
    expect((rrNext.json() as { posted: number }).posted).toBeGreaterThanOrEqual(1);

    // (c) The consume folded the PERSISTED (pinned, price-100) basis. A re-simulated world at
    // price 200 would have removed 2× the cost; the pin means it removed exactly pinnedCost.
    const consume = listLotMovements(db, E).find((m) => m.deltaQtyMinor.startsWith('-'))!;
    expect(consume.lotId).toBe(lotId); // continued the SAME pinned lot, not a re-created one
    expect(BigInt(consume.deltaCostMinor)).toBe(-pinnedCost);

    // The pinned P-period acquire row is STILL byte-identical (only a new consume row was appended).
    const acquireRows = db.prepare(`SELECT * FROM lot_movement WHERE delta_qty_minor NOT LIKE '-%' ORDER BY id`).all();
    expect(JSON.stringify(acquireRows)).toBe(snapshot);
  });
});
