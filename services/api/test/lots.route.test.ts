/**
 * Task 5 (C4 lot store): GET /entities/:id/lots — folded remaining lots with provenance,
 * movement history, and fail-loud drift objects (recompute-on-read vs persisted). The
 * endpoint is READ-ONLY: it recomputes expected lot state via simulateLots and compares,
 * but must never mutate persisted rows.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { insertPricePoint } from '../src/store/pricePointStore.js';

const E = 'e1';
const P = '2026-Q2';
const SUI = '0x2::sui::SUI';

interface RawOver { [k: string]: unknown }
function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: '0x2::sui::SUI',
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-10T00:00:00Z',
    economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function opening(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'OPENING_LOT', economicPurpose: 'OPENING_BALANCE', openingCostMinor: '500000', ...over });
}
function payment(over: RawOver = {}): RawOver {
  // Distinct txDigest from opening(): the JE/movement idempotency key derives from
  // (txDigest, eventIndex) alone, never eventId — since OPENING_LOT now ALSO posts a JE
  // (Task 1+2), sharing 'DIG' would collide the payment consume with the opening acquire.
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', txDigest: 'DIGPAY', ...over });
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  // D14: RECEIPT/PAYMENT events in this file need a price on their exact event date
  // (OPENING_LOT doesn't — historical cost, no valuation phase). Seed every date used below;
  // the value is irrelevant to the lot-fold assertions this file makes.
  for (const asOf of ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-04-10']) {
    insertPricePoint(app._db, {
      entityId: E, coinType: SUI, asOf, priceMinor: '100',
      quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
    });
  }
  return app;
}
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}
async function seedAndPost(app: FastifyInstance & { _db: Db }): Promise<void> {
  const db = app._db;
  seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
  seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
  await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
}

interface LotsBody {
  groups: Array<{ wallet: string; coinType: string; lots: Array<{ origin: string; costMinor: string; acquireJeId: string | null }> }>;
}
async function getLots(app: FastifyInstance & { _db: Db }): Promise<LotsBody> {
  const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
  expect(r.statusCode).toBe(200);
  return r.json() as LotsBody;
}

describe('GET /entities/:id/lots (C4 Task 5)', () => {
  it('clean state: one grouped lot with provenance, movements, and all drift null', async () => {
    const app = await freshApp();
    await seedAndPost(app);
    // Decimals now come from the asset registry (Task 7), not a fixture fallback. Register SUI
    // so the DTO can report its scale; without a registry row decimals is null (unknown scale).
    registerTestAsset(app._db, E, '0x2::sui::SUI', 9);

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { groups: Array<{ wallet: string; coinType: string; decimals: number | null; lots: Array<Record<string, unknown>> }> };
    expect(body.groups).toHaveLength(1);
    const g = body.groups[0]!;
    expect(g.wallet).toBe('0xacme');
    expect(g.coinType).toBe('0x2::sui::SUI');
    expect(g.decimals).toBe(9); // registry row (source 'chain'), not a fabricated default
    expect(g.lots).toHaveLength(1);
    const lot = g.lots[0]! as {
      lotId: string; origin: string; remainingQtyMinor: string; costMinor: string;
      originEventId: string; drift: unknown; movements: Array<{ eventId: string; deltaQtyMinor: string }>;
    };
    expect(lot.lotId).toBe('OPEN-open1');
    expect(lot.origin).toBe('opening');
    expect(lot.remainingQtyMinor).toBe('600000000');
    expect(lot.costMinor).toBe('300000');
    expect(lot.originEventId).toBe('open1');
    expect(lot.drift).toBeNull(); // recompute == persisted
    // Acquire (+) then consume (-) movement history.
    expect(lot.movements).toHaveLength(2);
    expect(lot.movements.some((m) => m.deltaQtyMinor === '1000000000')).toBe(true);
    expect(lot.movements.some((m) => m.deltaQtyMinor.startsWith('-'))).toBe(true);
    // Clean state: top-level gaps list is always present and empty.
    expect((body as unknown as { simulationGaps: string[] }).simulationGaps).toEqual([]);
  });

  it('gap-affected recompute: lot missing from sim is flagged recomputedIncomplete, never a fake zero', async () => {
    const app = await freshApp();
    const db = app._db;
    await seedAndPost(app);

    // Make the OPENING event unreplayable under current rules by corrupting its raw so
    // evaluate goes non-POSTABLE (missing openingCostMinor → OPENING_LOT can't post).
    // Persisted lot rows stay intact; only the sim replay hits a gap for this lot.
    db.prepare(`UPDATE events SET raw_json = json_remove(raw_json, '$.openingCostMinor') WHERE id = 'open1'`).run();

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      simulationGaps: string[];
      groups: Array<{ lots: Array<{ lotId: string; drift: null | { recomputed: { qtyMinor: string; costMinor: string }; persisted: { qtyMinor: string; costMinor: string }; recomputedIncomplete?: boolean } }> }>;
    };
    expect(body.simulationGaps.length).toBeGreaterThan(0);
    expect(body.simulationGaps).toContain('open1');
    const lot = body.groups[0]!.lots.find((l) => l.lotId === 'OPEN-open1')!;
    expect(lot.drift).not.toBeNull();
    // The {0,0} recompute is honestly flagged, not presented as a confident empty lot.
    expect(lot.drift!.recomputedIncomplete).toBe(true);
    expect(lot.drift!.persisted).toEqual({ qtyMinor: '600000000', costMinor: '300000' });
  });

  it('sim-only drift: deleting a persisted lot surfaces the sim lot with persisted 0/0', async () => {
    const app = await freshApp();
    const db = app._db;
    await seedAndPost(app);

    // Nuke the persisted lot entirely (all its movement rows). The recompute still
    // produces it, so the union scan must emit it as a sim-only drift entry.
    const before = db.prepare(`SELECT delta_qty_minor FROM lot_movement WHERE lot_id = 'OPEN-open1' AND delta_qty_minor NOT LIKE '-%'`).get();
    expect(before).toBeTruthy();
    db.prepare(`DELETE FROM lot_movement WHERE lot_id = 'OPEN-open1'`).run();

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      simulationGaps: string[];
      groups: Array<{ wallet: string; coinType: string; lots: Array<{ lotId: string; remainingQtyMinor: string; costMinor: string; originEventId: string; origin: string; movements: unknown[]; drift: null | { recomputed: { qtyMinor: string; costMinor: string }; persisted: { qtyMinor: string; costMinor: string } } }> }>;
    };
    expect(body.simulationGaps).toEqual([]); // replay is clean; the lot's recompute is honest
    const g = body.groups.find((x) => x.wallet === '0xacme' && x.coinType === '0x2::sui::SUI')!;
    const lot = g.lots.find((l) => l.lotId === 'OPEN-open1')!;
    expect(lot.remainingQtyMinor).toBe('0'); // persisted side is genuinely empty
    expect(lot.costMinor).toBe('0');
    expect(lot.origin).toBe('opening');
    expect(lot.originEventId).toBe('open1'); // from the sim replay, not fabricated
    expect(lot.movements).toEqual([]);
    expect(lot.drift).not.toBeNull();
    expect(lot.drift!.recomputed).toEqual({ qtyMinor: '600000000', costMinor: '300000' });
    expect(lot.drift!.persisted).toEqual({ qtyMinor: '0', costMinor: '0' });
  });

  it('drift: a tampered persisted row surfaces a drift object with BOTH values; the read mutates nothing', async () => {
    const app = await freshApp();
    const db = app._db;
    await seedAndPost(app);

    // Tamper the OPEN- acquire cost so the persisted fold diverges from the recompute.
    db.prepare(`UPDATE lot_movement SET delta_cost_minor = '999999' WHERE lot_id = 'OPEN-open1' AND delta_qty_minor NOT LIKE '-%'`).run();
    // Persisted fold now: cost = 999999 (acquire) - 200000 (consume) = 799999; sim stays 300000.

    const before = db.prepare('SELECT id, delta_qty_minor, delta_cost_minor, lot_seq FROM lot_movement ORDER BY id').all();

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { groups: Array<{ lots: Array<{ lotId: string; costMinor: string; drift: null | { recomputed: { qtyMinor: string; costMinor: string }; persisted: { qtyMinor: string; costMinor: string } } }> }> };
    const lot = body.groups[0]!.lots[0]!;
    expect(lot.costMinor).toBe('799999'); // persisted fold reflects the tamper
    expect(lot.drift).not.toBeNull();
    expect(lot.drift!.recomputed).toEqual({ qtyMinor: '600000000', costMinor: '300000' });
    expect(lot.drift!.persisted).toEqual({ qtyMinor: '600000000', costMinor: '799999' });

    // Read-only proof: rows byte-identical after the GET.
    const after = db.prepare('SELECT id, delta_qty_minor, delta_cost_minor, lot_seq FROM lot_movement ORDER BY id').all();
    expect(after).toEqual(before);
  });

  it('drained pool: a lot fully consumed in BOTH ledgers yields no phantom drift entry', async () => {
    const app = await freshApp();
    const db = app._db;
    // Opening lot (1000000000 qty) consumed by two payments that together exhaust it
    // exactly, in both the persisted fold and the sim replay. Neither side has anything
    // left — a lot both agree is gone must produce zero drift noise.
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z', quantityMinor: '400000000' }));
    seedAuto(db, 'pay2', payment({ eventId: 'pay2', eventTime: '2026-04-06T00:00:00Z', quantityMinor: '600000000', txDigest: 'DIG2', eventIndex: 1 }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      simulationGaps: string[];
      groups: Array<{ wallet: string; coinType: string; lots: Array<{ lotId: string }> }>;
    };
    expect(body.simulationGaps).toEqual([]); // clean replay, no gaps
    // The drained pool must not surface a phantom {0,0}-vs-{0,0} drift entry for OPEN-open1.
    const g = body.groups.find((x) => x.wallet === '0xacme' && x.coinType === '0x2::sui::SUI');
    expect(g === undefined || g.lots.every((l) => l.lotId !== 'OPEN-open1')).toBe(true);
  });

  it('zero-events entity: empty groups, no 500', async () => {
    const app = await freshApp();
    insertEntity(app._db, { id: 'empty', displayName: 'Empty', chainObjectId: '0xe', capObjectId: '0xf', originalPackageId: '0xp' });
    const r = await app.inject({ method: 'GET', url: `/entities/empty/lots` });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { groups: unknown[] }).groups).toEqual([]);
  });

  it('acquireJeId discloses anchoring: real id for JE-backed lots, null for zero-basis opening (spec §3.5b)', async () => {
    const app = await freshApp();
    const db = app._db;
    // Receipt → derived lot; non-zero OPENING_LOT → JE-backed opening lot; zero-basis
    // OPENING_LOT → stays JE-less (Task 1+2). Distinct txDigest per event: the JE/movement
    // idempotency key derives from (txDigest, eventIndex) alone, never eventId.
    seedAuto(db, 'r1', baseEvent({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', eventTime: '2026-04-02T00:00:00Z' }));
    seedAuto(db, 'open2', opening({ eventId: 'open2', txDigest: 'DIG-OPEN2', openingCostMinor: '0', eventTime: '2026-04-03T00:00:00Z' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });

    const body = await getLots(app);
    const lots = body.groups.flatMap((g) => g.lots);
    const derived = lots.find((l) => l.origin === 'derived')!;
    const anchored = lots.find((l) => l.origin === 'opening' && l.costMinor !== '0')!;
    const zeroBasis = lots.find((l) => l.origin === 'opening' && l.costMinor === '0')!;
    expect(derived.acquireJeId).toMatch(/^je-/);
    expect(anchored.acquireJeId).toMatch(/^je-/);   // JE-backed opening lot is anchored
    expect(zeroBasis.acquireJeId).toBeNull();        // D2: zero basis unanchored, disclosed as such
  });

  it('unknown entity → 404 (mirrors other GET routes)', async () => {
    const app = await freshApp();
    const r = await app.inject({ method: 'GET', url: `/entities/ghost/lots` });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ENTITY_NOT_FOUND');
  });
});
