/**
 * Task 3 (C4 lot store): run-rules persists lot movements atomically alongside JEs,
 * and the ingest OPENING_LOT bypass approves deterministically without consulting the LLM.
 *
 * Task 1+2 (opening-equity JE): a non-zero OPENING_LOT now ALSO posts a real JE
 * (Dr ACQUISITION / Cr OPENING_EQUITY, both amountMinor === openingCostMinor) — the
 * JE-less POSTABLE branch (spec §7.8.3) now applies only to zero-basis opening lots and
 * same-wallet INTERNAL_TRANSFER legs.
 *
 * COUPLING (plan-explicit): until Task 4 flips buildRuleInput to fold REAL lots, a
 * payment consume references the hardcoded demo lot ('lot-1'), which has no persisted
 * acquire row. The two tests that assert the ACQUIRE lot_seq / chronological folding are
 * therefore written against the post-Task-4 contract but marked skip ('enabled in Task 4').
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, getEvent } from '../src/store/eventStore.js';
import { listLotMovements, acquireLotSeq } from '../src/store/lotMovementStore.js';
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
  // (txDigest, eventIndex) alone (never eventId) — now that OPENING_LOT ALSO posts a JE,
  // sharing 'DIG' would collide the payment's consume idempotency key with the opening's
  // acquire (both key on the same lotId) and fail loud as ledger corruption.
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', txDigest: 'DIGPAY', ...over });
}

async function freshApp(client?: GeminiClient): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false, client);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  // D14: RECEIPT/PAYMENT events in this file need a price on their exact event date
  // (OPENING_LOT doesn't — historical cost, no valuation phase). Seed every date used below.
  for (const asOf of ['2026-04-01', '2026-04-05', '2026-04-10', '2026-04-20']) {
    insertPricePoint(app._db, {
      entityId: E, coinType: SUI, asOf, priceMinor: '100',
      quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
    });
  }
  return app;
}

/** Seed an event and drive it INGESTED→AUTO deterministically (no LLM) so run-rules picks it up. */
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

describe('run-rules persists lot movements atomically (C4 Task 3)', () => {
  it('persists lot movements alongside JEs; second run is a no-op (spec §6 #1/#3)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));

    const r1 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r1.statusCode).toBe(200);
    const movesAfterRun1 = listLotMovements(db, E);
    expect(movesAfterRun1.length).toBeGreaterThanOrEqual(2); // opening acquire + payment consume

    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r2.statusCode).toBe(200);
    expect(listLotMovements(db, E)).toHaveLength(movesAfterRun1.length); // replay: zero new rows
  });

  it('non-zero OPENING_LOT posts ONE anchored JE (Dr ACQUISITION / Cr OPENING_EQUITY) and a real je_id (Task 1+2)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));

    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    const openingMoves = listLotMovements(db, E).filter((m) => m.lotId.startsWith('OPEN-'));
    expect(openingMoves).toHaveLength(1);
    // Anchored to a real JE now — never null, never a hardcoded hash (the sha256 idempotencyKey
    // is an implementation detail; only the `je-<eventId>-<key>` shape is a stable contract).
    expect(openingMoves[0]!.jeId).not.toBeNull();
    expect(openingMoves[0]!.jeId).toMatch(/^je-open1-/);
    const jeRow = db.prepare('SELECT je_json FROM journal_entries WHERE event_id = ?').get('open1') as { je_json: string } | undefined;
    expect(jeRow).toBeTruthy();
    const je = JSON.parse(jeRow!.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; leg: string }> };
    expect(je.lines).toEqual([
      { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '500000', origCoinType: '0x2::sui::SUI', origQtyMinor: '1000000000', priceRef: null, fxRef: null, leg: 'ACQUISITION' },
      { account: 'OpeningBalanceEquity', side: 'CREDIT', amountMinor: '500000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
    ]);
  });

  it('atomicity: injected movement-insert failure rolls back the JE too (spec §6 #5)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
    // Sabotage: drop the movement table so the movement write throws mid-transaction.
    db.exec('DROP TABLE lot_movement');

    const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r.statusCode).toBe(500); // fail-loud, not partial
    // The JE inserted earlier in the same transaction must have been rolled back.
    expect(db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE entity_id = ?').get(E)).toMatchObject({ c: 0 });
    // markPosted joins the SAME transaction (spec §6 #2) — the status flip must roll back too, else a
    // crash window leaves the event AUTO-with-committed-movements OR POSTED-with-no-JE → double consume.
    expect(getEvent(db, 'pay1')!.status).not.toBe('POSTED');
  });

  it('ingest: OPENING_LOT bypasses the LLM and lands APPROVED deterministically (spec §3, model-vs-code rule)', async () => {
    const throwing: GeminiClient = {
      async generateJson() { throw new Error('LLM must not be consulted for OPENING_LOT'); },
    };
    const app = await freshApp(throwing);
    const db = app._db;
    // Seed a raw OPENING_LOT event in INGESTED (the state ingest() sweeps).
    insertEvent(db, { id: 'ol1', entityId: E, rawJson: JSON.stringify(opening({ eventId: 'ol1' })) });

    const r = await app.inject({ method: 'POST', url: `/entities/${E}/ingest`, payload: {} });
    expect(r.statusCode).toBe(200); // no 500 → the throwing AI client was never called
    const ev = getEvent(db, 'ol1')!;
    expect(ev.status).toBe('APPROVED');
    expect(ev.finalEventType).toBe('OPENING_LOT');
  });

  // ---- Enabled in Task 4 (real-lot fold): buildRuleInput now folds persisted lots. ----
  it('consume rows carry the ACQUIRE lot_seq and provenance stamps (spec §2)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    const consume = listLotMovements(db, E).find((m) => m.deltaQtyMinor.startsWith('-'))!;
    expect(consume.lotSeq).toBe(acquireLotSeq(db, E, consume.lotId));
    expect(consume.costBasisMethod).toBe('FIFO');
    expect(consume.policySetVersion).toBe('demo-ps-1');
  });

  it('candidates process in eventTime order (payment cannot precede its opening lot)', async () => {
    const app = await freshApp();
    const db = app._db;
    // Payment inserted BEFORE the opening in the events table but dated LATER.
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-20T00:00:00Z' }));
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    // Both post a JE now (opening's Dr/Cr anchor + the payment's disposal JE) — the point of
    // this test is the ORDER (opening must post before the payment can find a lot to consume),
    // not the count; posted=2 (not an INSUFFICIENT_LOT exception) proves that ordering held.
    expect(r.json().posted).toBe(2);
  });

  // Task 3 left a transitional consumeLotSeq() fallback that, when acquireLotSeq found no
  // acquire row, stamped the consume with the CONSUME event's own '<eventTime>|<eventId>'.
  // Task 4 deleted it (the hardcoded lot with no acquire row is gone). This test proves the
  // fallback is gone: the consume must carry the OPENING acquire's stamp, never a provisional
  // self-stamp — and acquireLotSeq (which routes.ts now calls unguarded) fails loud for a lot
  // with no acquire row rather than inventing a seq.
  it('consume stamps the ACQUIRE seq — the deleted provisional self-stamp is gone; missing acquire fails loud', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    const consume = listLotMovements(db, E).find((m) => m.deltaQtyMinor.startsWith('-'))!;
    // Carries the OPENING acquire's stamp, NOT the payment's own (the old fallback value).
    expect(consume.lotSeq).toBe('2026-04-01T00:00:00Z|open1');
    expect(consume.lotSeq).not.toBe('2026-04-05T00:00:00Z|pay1');
    // The primitive the consume path relies on: no acquire row → throw, never a fabricated seq.
    expect(() => acquireLotSeq(db, E, 'OPEN-ghost')).toThrow(/no acquire row/i);
  });
});
