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
import { insertPricePoint } from '../src/store/pricePointStore.js';

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
  // D14: RECEIPT/PAYMENT events in this file need a price on their exact event date
  // (OPENING_LOT doesn't — historical cost, no valuation phase).
  for (const asOf of ['2026-04-01', '2026-04-20']) {
    insertPricePoint(app._db, {
      entityId: E, coinType: SUI, asOf, priceMinor: '100',
      quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
    });
  }
  return app;
}
interface JeLine { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }
/** GL balance of a control account, folded from persisted je_json (DEBIT − CREDIT). All BigInt. */
function glBalance(db: Db, account: string): bigint {
  const rows = db.prepare('SELECT je_json FROM journal_entries WHERE entity_id = ?').all(E) as { je_json: string }[];
  let bal = 0n;
  for (const r of rows) {
    const je = JSON.parse(r.je_json) as { lines: JeLine[] };
    for (const l of je.lines) {
      if (l.account !== account) continue;
      bal += l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor);
    }
  }
  return bal;
}
interface LotsBody {
  groups: Array<{ wallet: string; coinType: string; lots: Array<{ origin: string; remainingQtyMinor: string; costMinor: string }> }>;
  simulationGaps: string[];
}
async function getLots(app: FastifyInstance & { _db: Db }): Promise<LotsBody> {
  const r = await app.inject({ method: 'GET', url: `/entities/${E}/lots` });
  expect(r.statusCode).toBe(200);
  return r.json() as LotsBody;
}
function sumRemainingCost(body: LotsBody, filter?: (o: string) => boolean): bigint {
  let s = 0n;
  for (const g of body.groups) for (const l of g.lots) if (!filter || filter(l.origin)) s += BigInt(l.costMinor);
  return s;
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
      // D14: RECEIPT/PAYMENT need a price on their event date (this test builds its own db,
      // bypassing freshApp's seeding above).
      for (const asOf of ['2026-04-01', '2026-04-20']) {
        insertPricePoint(db, {
          entityId: E, coinType: SUI, asOf, priceMinor: '100',
          quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
        });
      }
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

  // --- Task 5 extensions: opening-equity JE hostile cases (spec §3.4, §6) ---

  it('monkey: run-rules replay is a no-op — second run posts 0, GL/OBE unchanged', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: '500000' }));
    const r1 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r1.statusCode).toBe(200);
    expect((r1.json() as { posted: number }).posted).toBe(1);
    const daBefore = glBalance(db, 'DigitalAssets');
    const obeBefore = glBalance(db, 'OpeningBalanceEquity');
    expect(daBefore).toBeGreaterThan(0n); // guard against a vacuous 0n === 0n pass below

    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as { posted: number }).posted).toBe(0); // markPosted already flipped AUTO→POSTED
    expect(glBalance(db, 'DigitalAssets')).toBe(daBefore);
    expect(glBalance(db, 'OpeningBalanceEquity')).toBe(obeBefore);
    await app.close();
  });

  it('monkey: same-key OPENING_LOT ingest with a DIFFERENT eventId/cost FAILS LOUD — phantom-lot forgery blocked (dual-review R1 #1)', async () => {
    // Two ingests share (entityId, bookId, rawPayloadHash, txDigest, eventIndex) — exactly the
    // fields the engine's JE idempotency key is built from (eventId is deliberately NOT one of
    // them, see rules-engine/src/core/idempotency.ts) — but carry a DIFFERENT eventId and
    // openingCostMinor. This is NOT a replay: it's a forged event riding in under the first
    // event's JE identity. Before this fix, insertJournalEntry silently no-op'd on the key
    // collision (anchorJeId stayed null) while the movement insert still went through under a
    // FRESH key (`${anchorKey}|OPEN-<fj2>`), landing a lot_movement row with je_id NULL and
    // attacker-chosen basis — a phantom "legacy-looking" lot. It must now fail loud instead.
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'fj1', opening({ eventId: 'fj1', txDigest: 'DIG-DUP', eventIndex: 0, openingCostMinor: '500000' }));
    const r1 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r1.statusCode).toBe(200);
    expect((r1.json() as { posted: number }).posted).toBe(1);

    seedAuto(db, 'fj2', opening({ eventId: 'fj2', txDigest: 'DIG-DUP', eventIndex: 0, openingCostMinor: '999999' }));
    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    // Fastify's global error handler (routes.ts setErrorHandler) maps any uncaught store throw to
    // a 500 with the generic INTERNAL envelope — pin the exact surface so this test breaks loudly
    // if that mapping ever silently changes back to swallowing the error.
    expect(r2.statusCode).toBe(500);
    expect(r2.json()).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } });

    // No phantom lot, no phantom JE: the whole persist() transaction for fj2 rolled back atomically.
    expect(listLotMovements(db, E).some((m) => m.lotId === 'OPEN-fj2')).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS c FROM journal_entries WHERE entity_id = ?').get(E)).toEqual({ c: 1 });
    await app.close();
  });

  it('monkey: cross-event duplicate registration double-counts SYMMETRICALLY — documented non-defense (spec §6)', async () => {
    // Two distinct real-world opening events (different eventIds, different txDigests, that happen
    // to declare the SAME wallet/coin/cost). The JE idempotency key derives from (entityId, bookId,
    // rawPayloadHash, txDigest, eventIndex) — which excludes eventId — so a SHARED (txDigest,
    // eventIndex, rawPayloadHash) now FAILS LOUD on payload mismatch (insertJournalEntry throws;
    // see the dedicated forgery test above) rather than silently colliding. Distinct digests are
    // used here on purpose to exercise the intended cross-event DOUBLE-POST path instead. The
    // engine has no cross-event
    // dedup for OPENING_LOT — it isn't supposed to, since two truly independent lots CAN share
    // those attributes — so both post, and OBE (the credit side) doubles. This pins that the
    // doubling is SYMMETRIC (both DigitalAssets and OpeningBalanceEquity double together, so the
    // subledger↔GL identity still holds) rather than a defense nobody should rely on.
    const app = await freshApp();
    const db = app._db;
    const cost = 500000n;
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: cost.toString() }));
    seedAuto(db, 'open2', opening({ eventId: 'open2', txDigest: 'DIG-OPEN2', openingCostMinor: cost.toString() }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);
    expect((rr.json() as { posted: number }).posted).toBe(2); // both post — no cross-event dedup

    expect(glBalance(db, 'OpeningBalanceEquity')).toBe(-2n * cost);
    expect(glBalance(db, 'DigitalAssets')).toBe(2n * cost);

    // Full tie-out identity still holds — the doubling is symmetric, not a books/subledger split.
    const lotsBody = await getLots(app);
    expect(lotsBody.simulationGaps).toEqual([]);
    expect(sumRemainingCost(lotsBody)).toBe(glBalance(db, 'DigitalAssets'));
    await app.close();
  });

  it('monkey: huge openingCostMinor (>2^63) survives BigInt end-to-end', async () => {
    const huge = '99999999999999999999999999';
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-HUGE1', openingCostMinor: huge }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);
    expect((rr.json() as { posted: number }).posted).toBe(1);

    expect(glBalance(db, 'DigitalAssets')).toBe(BigInt(huge));
    expect(glBalance(db, 'OpeningBalanceEquity')).toBe(-BigInt(huge));

    const lotsBody = await getLots(app);
    expect(lotsBody.simulationGaps).toEqual([]);
    expect(sumRemainingCost(lotsBody)).toBe(glBalance(db, 'DigitalAssets')); // tie-out identity holds at extreme scale
    await app.close();
  });

  it('monkey: negative and non-integer openingCostMinor never post', async () => {
    const badCosts: Array<[string, string]> = [
      ['negative', '-5'],
      ['non-integer decimal', '1.5'],
      ['scientific notation', '1e9'],
      ['leading-zero double-zero', '00'],
      ['leading-zero non-canonical', '007'],
    ];
    for (const [label, cost] of badCosts) {
      const app = await freshApp();
      const db = app._db;
      seedAuto(db, 'bad1', opening({ eventId: 'bad1', txDigest: `DIG-BAD-${label}`, openingCostMinor: cost }));
      const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
      expect(rr.statusCode, label).toBe(200);
      // posted=0 AND skipped=1: the event WAS a run candidate and was actively rejected
      // (SCHEMA_INVALID → non-POSTABLE → skipped++), not merely absent from the run.
      const rrBody = rr.json() as { posted: number; skipped: number };
      expect(rrBody.posted, label).toBe(0);
      expect(rrBody.skipped, label).toBe(1);
      expect(listLotMovements(db, E), label).toHaveLength(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM journal_entries WHERE entity_id = ?').get(E), label)
        .toEqual({ c: 0 });
      await app.close();
    }
  });
});
