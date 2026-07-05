/**
 * Task 6 (C4 lot store) — subledger↔GL tie-out invariant (spec §8, CPA C1).
 *
 * The lot subledger and the general ledger are two views of the same economic fact, so
 * they MUST reconcile to the cent. For digital assets the control account is 'DigitalAssets':
 *   - a RECEIVABLE_SETTLEMENT receipt DEBITs DigitalAssets by fair value AND acquires a lot at
 *     the same cost (receiptRules.buildJeLines / buildLotPlan — both use fvFunctionalMinor);
 *   - a VENDOR_PAYMENT disposal CREDITs DigitalAssets by the FIFO carrying cost AND consumes
 *     lots by that same carrying (paymentRules — the CREDIT amount == Σ consumed costMinor).
 * Therefore `Σ remaining lot costMinor === DigitalAssets balance` is an accounting IDENTITY,
 * not a coincidence. A test that computes both sides from the SAME persisted rows and asserts
 * equality is the canary that catches any drift between the JE writer and the lot writer.
 *
 * Opening lots break the naive identity by design (spec §3): an OPENING_LOT loads historical
 * basis into the subledger with NO journal entry — its cost never hits DigitalAssets this
 * round. So with opening lots the identity becomes an EXCLUSION identity:
 *   Σ remaining − openingBasisRemaining === DigitalAssets balance.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';

const E = 'e1';
const P = '2026-Q2';
const SUI = '0x2::sui::SUI';

interface RawOver { [k: string]: unknown }
function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-10T00:00:00Z',
    economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function receipt(over: RawOver = {}): RawOver { return baseEvent(over); }
function payment(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', ...over });
}
function opening(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'OPENING_LOT', economicPurpose: 'OPENING_BALANCE', openingCostMinor: '500000', ...over });
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

describe('subledger ↔ GL tie-out invariant (C4 Task 6, spec §8)', () => {
  it('WITHOUT opening lots: Σ remaining lot costMinor === DigitalAssets GL balance', async () => {
    // A receipt (acquire → DEBIT DigitalAssets) and a partial disposal (consume → CREDIT
    // DigitalAssets by FIFO carrying). Both sides derive from the SAME cost basis, so the
    // lot subledger's remaining basis MUST equal the GL control account to the cent.
    const app = await freshApp();
    const db = app._db;
    // Distinct txDigest per event: real on-chain events are uniquely referenced, and the JE
    // idempotency key derives from (txDigest, eventIndex) — sharing it would collide the receipt's
    // acquire movement with the payment's consume, silently dropping the disposal (fail-loud now).
    seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', quantityMinor: '1000000000', eventTime: '2026-04-10T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', quantityMinor: '400000000', eventTime: '2026-04-20T00:00:00Z' }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);

    const body = await getLots(app);
    expect(body.simulationGaps).toEqual([]); // clean replay — the identity is meaningful
    const subledger = sumRemainingCost(body);
    const gl = glBalance(db, 'DigitalAssets');
    expect(subledger > 0n).toBe(true); // guard: a degenerate 0 === 0 would pass vacuously
    expect(subledger).toBe(gl);
  });

  it('WITH an opening lot: Σ remaining − openingBasisRemaining === DigitalAssets (opening has no GL entry)', async () => {
    // The opening lot loads historical basis into the SUBLEDGER only — spec §3: it produces
    // NO journal entry, so its cost never touches the DigitalAssets control account this round.
    // We keep the opening lot UNCONSUMED (the disposal is fully covered by the older receipt
    // lot via FIFO) so openingBasisRemaining == its full loaded basis, making the exclusion
    // term exactly the un-booked opening cost. That is the WHY: excluding it reconciles the
    // subledger back to the GL.
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', quantityMinor: '1000000000', eventTime: '2026-04-10T00:00:00Z' }));
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: '500000', eventTime: '2026-04-15T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', quantityMinor: '400000000', eventTime: '2026-04-20T00:00:00Z' }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);

    const body = await getLots(app);
    expect(body.simulationGaps).toEqual([]);
    const total = sumRemainingCost(body);
    const openingBasisRemaining = sumRemainingCost(body, (o) => o === 'opening');
    const nonOpening = sumRemainingCost(body, (o) => o !== 'opening');
    // The opening lot is untouched: its remaining basis is the full loaded cost, proving the
    // disposal drew from the receipt lot (FIFO oldest) and never the un-booked opening lot.
    expect(openingBasisRemaining).toBe(500000n);
    expect(nonOpening > 0n).toBe(true);

    const gl = glBalance(db, 'DigitalAssets');
    expect(total - openingBasisRemaining).toBe(gl);
  });
});
