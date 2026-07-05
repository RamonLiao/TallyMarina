/**
 * Task 6 (C4 lot store) — monkey suite (repo test.md: mandatory extreme/adversarial testing).
 *
 * Tries to break the lot ledger's integrity guarantees:
 *   1. Garbage OPENING_LOT payloads must fail CLOSED — zero lot_movement rows written. The
 *      schema gate is strict: quantityMinor must be a strictly-positive integer string, so
 *      '0'/negative/whitespace/scientific-notation qty and a missing cost all reject. Note the
 *      asymmetry the spec calls out: '0' QUANTITY is illegal but '0' COST is legal — a control
 *      case proves a well-formed zero-cost opening lot DOES post.
 *   2. Sequential replay idempotency: 20 stacked run-rules calls must leave the SAME row count as
 *      one run — the status-transition guard (markPosted flips AUTO→POSTED) stops replays 2-20
 *      from ever seeing a candidate to post, since the handler body has no internal await and
 *      Promise.all serializes them in effect. The DB-level INSERT OR IGNORE dedup on
 *      idempotency_key is exercised separately, directly against the store (see next test).
 *   3. Durability: close the DB file and reopen it, re-run — the persisted movements replay to
 *      a no-op (idempotency survives process restart, not just in-memory state).
 *   4. GET /lots on a zero-event entity returns empty groups, never a 500.
 */
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildTestApp, cfg, stubClassifyClient } from './helpers/app.js';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { listLotMovements, insertLotMovement } from '../src/store/lotMovementStore.js';

const E = 'e1';
const P = '2026-Q2';
const SUI = '0x2::sui::SUI';

interface RawOver { [k: string]: unknown }
function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function opening(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'OPENING_LOT', economicPurpose: 'OPENING_BALANCE', openingCostMinor: '500000', ...over });
}
function receipt(over: RawOver = {}): RawOver { return baseEvent(over); }
function payment(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', txDigest: 'DIGPAY', eventTime: '2026-04-20T00:00:00Z', ...over });
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
  return app;
}
/** Same wiring as buildTestApp but over an already-open (file-backed) Db — for the reopen test. */
function appOnDb(db: Db): FastifyInstance & { _db: Db } {
  const app = Fastify() as unknown as FastifyInstance & { _db: Db };
  app._db = db;
  registerRoutes(app, {
    db, cfg, classifyClient: stubClassifyClient, copilotClient: stubClassifyClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  return app;
}

describe('monkey: lot ledger integrity under garbage, concurrency, restart (C4 Task 6)', () => {
  it('garbage OPENING_LOT payloads fail closed — ZERO lot_movement rows each', async () => {
    // eventTime stays valid (period derivation must succeed) so the ONLY reason a row is
    // withheld is the strict quantity/cost gate — the fail-closed we actually want to prove.
    const garbage: Array<[string, RawOver]> = [
      ['negative quantity', { quantityMinor: '-100' }],
      ['zero quantity (strictly-positive gate)', { quantityMinor: '0' }],
      ['whitespace-padded quantity', { quantityMinor: '  100  ' }],
      ['scientific-notation quantity', { quantityMinor: '1e30' }],
      ['missing opening cost', { openingCostMinor: undefined }],
    ];
    for (const [label, over] of garbage) {
      const app = await freshApp();
      const db = app._db;
      const raw = opening({ eventId: 'g1', ...over });
      if ((over as { openingCostMinor?: unknown }).openingCostMinor === undefined) delete (raw as { openingCostMinor?: unknown }).openingCostMinor;
      seedAuto(db, 'g1', raw);
      const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
      // run-rules itself returns 200 (the bad event is skipped, not a server crash)…
      expect(r.statusCode, label).toBe(200);
      // …but NOTHING was written to the derived ledger.
      expect(listLotMovements(db, E), label).toHaveLength(0);
      await app.close();
    }
  });

  it("control: a well-formed OPENING_LOT with '0' COST is LEGAL and posts exactly one acquire row", async () => {
    // Guards the test above from vacuously passing: '0' cost (unlike '0' quantity) is valid,
    // so the rejection path is genuinely about malformed input, not a blanket "nothing posts".
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'ok1', opening({ eventId: 'ok1', openingCostMinor: '0' }));
    const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r.statusCode).toBe(200);
    const moves = listLotMovements(db, E);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.deltaCostMinor).toBe('0');
    await app.close();
  });

  it('20× stacked run-rules replay → status guard blocks re-post, movement count identical to a single run', async () => {
    // Reference: one run over a receipt + partial disposal.
    const ref = await freshApp();
    seedAuto(ref._db, 'r1', receipt({ eventId: 'r1' }));
    seedAuto(ref._db, 'pay1', payment({ eventId: 'pay1' }));
    await ref.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    const singleRunCount = listLotMovements(ref._db, E).length;
    expect(singleRunCount).toBeGreaterThan(0);
    await ref.close();

    // Same seed, but stack 20 run-rules calls via Promise.all. NOTE: the handler body has no
    // internal await, so these run sequentially in effect (JS event loop, single-threaded) — run
    // #1 posts everything and flips AUTO→POSTED via markPosted, so runs #2-20 see zero candidates.
    // This proves the status-transition guard, NOT the INSERT OR IGNORE dedup (that's exercised
    // directly against the store below, since this handler-level test can never trigger it).
    const app = await freshApp();
    seedAuto(app._db, 'r1', receipt({ eventId: 'r1' }));
    seedAuto(app._db, 'pay1', payment({ eventId: 'pay1' }));
    await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })),
    );
    expect(listLotMovements(app._db, E)).toHaveLength(singleRunCount);
    await app.close();
  });

  it('dedup: same key + IDENTICAL payload is a no-op; same key + DIFFERENT payload THROWS (fail-loud)', async () => {
    // Exercises the UNIQUE(idempotency_key) dedup path directly, independent of the status guard
    // above. A true replay (identical economic payload) must no-op; a same-key row with a DIFFERENT
    // payload must throw rather than silently drop — a silent drop would diverge subledger from GL.
    const app = await freshApp();
    seedAuto(app._db, 'r1', receipt({ eventId: 'r1' }));
    seedAuto(app._db, 'pay1', payment({ eventId: 'pay1' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    const before = listLotMovements(app._db, E);
    expect(before.length).toBeGreaterThan(0);

    for (const m of before) {
      // True replay: identical payload, different PK → 'duplicate' no-op.
      expect(insertLotMovement(app._db, { ...m, id: `${m.id}-replay` }), m.idempotencyKey).toBe('duplicate');
      // Same key, DIFFERENT payload → must throw, never silent-drop.
      expect(() => insertLotMovement(app._db, {
        ...m, id: `${m.id}-corrupt`, deltaQtyMinor: '999999999', deltaCostMinor: '999999999',
      }), m.idempotencyKey).toThrow(/DIFFERENT payload/i);
    }

    const after = listLotMovements(app._db, E);
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
    await app.close();
  });

  it('durability: replay after DB file close + reopen writes no new rows', async () => {
    const dbPath = join('/tmp', `c4-monkey-${process.pid}-${Date.now()}.db`);
    try {
      // First process lifetime: post, capture the persisted count.
      let db = openDb(dbPath);
      insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
      seedAuto(db, 'r1', receipt({ eventId: 'r1' }));
      seedAuto(db, 'pay1', payment({ eventId: 'pay1' }));
      let app = appOnDb(db);
      await app.ready();
      await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
      const countBefore = listLotMovements(db, E).length;
      expect(countBefore).toBeGreaterThan(0);
      await app.close();
      db.close(); // checkpoints WAL to the main db file

      // Second process lifetime: reopen the SAME file, re-run. Idempotency must survive restart.
      db = openDb(dbPath);
      app = appOnDb(db);
      await app.ready();
      await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
      expect(listLotMovements(db, E)).toHaveLength(countBefore); // zero new rows
      await app.close();
      db.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
    }
  });

  it('GET /lots on a zero-event entity → empty groups, no 500', async () => {
    const app = await freshApp(); // entity E exists but has no events
    const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { groups: unknown[] }).groups).toEqual([]);
    await app.close();
  });
});
