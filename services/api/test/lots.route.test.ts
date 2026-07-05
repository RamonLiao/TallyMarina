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

const E = 'e1';
const P = '2026-Q2';

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
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', ...over });
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
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

describe('GET /entities/:id/lots (C4 Task 5)', () => {
  it('clean state: one grouped lot with provenance, movements, and all drift null', async () => {
    const app = await freshApp();
    await seedAndPost(app);

    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { groups: Array<{ wallet: string; coinType: string; decimals: number; lots: Array<Record<string, unknown>> }> };
    expect(body.groups).toHaveLength(1);
    const g = body.groups[0]!;
    expect(g.wallet).toBe('0xacme');
    expect(g.coinType).toBe('0x2::sui::SUI');
    expect(g.decimals).toBe(9); // no recon fixture row → ?? 9 default (collect.ts:60 convention)
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

  it('zero-events entity: empty groups, no 500', async () => {
    const app = await freshApp();
    insertEntity(app._db, { id: 'empty', displayName: 'Empty', chainObjectId: '0xe', capObjectId: '0xf', originalPackageId: '0xp' });
    const r = await app.inject({ method: 'GET', url: `/entities/empty/lots` });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { groups: unknown[] }).groups).toEqual([]);
  });

  it('unknown entity → 404 (mirrors other GET routes)', async () => {
    const app = await freshApp();
    const r = await app.inject({ method: 'GET', url: `/entities/ghost/lots` });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ENTITY_NOT_FOUND');
  });
});
