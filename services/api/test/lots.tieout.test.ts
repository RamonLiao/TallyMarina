/**
 * Task 6 (C4 lot store) — subledger↔GL tie-out invariant (spec §8, CPA C1; exclusion boundary
 * spec §3.5).
 *
 * The lot subledger and the general ledger are two views of the same economic fact, so
 * they MUST reconcile to the cent. For digital assets the control account is 'DigitalAssets':
 *   - a RECEIVABLE_SETTLEMENT receipt DEBITs DigitalAssets by fair value AND acquires a lot at
 *     the same cost (receiptRules.buildJeLines / buildLotPlan — both use fvFunctionalMinor);
 *   - a VENDOR_PAYMENT disposal CREDITs DigitalAssets by the FIFO carrying cost AND consumes
 *     lots by that same carrying (paymentRules — the CREDIT amount == Σ consumed costMinor);
 *   - a non-zero OPENING_LOT (Task 1+2) ALSO posts a real JE (Dr DigitalAssets /
 *     Cr OpeningBalanceEquity), so its basis hits the GL too and joins the plain identity above
 *     with no exclusion term.
 *
 * The exclusion term only matters for JE-less opening lots — legacy rows persisted BEFORE this
 * feature existed (je_id NULL, no JE, per spec §3.5's "consumed-legacy boundary"). Their basis
 * never touched DigitalAssets, but a disposal CREDIT doesn't discriminate by lot origin: FIFO
 * may consume PART of a legacy lot, crediting the GL for that consumed slice while the lot's
 * remaining basis subledger-side shrinks by the same slice. So the identity must exclude the
 * legacy lot's ORIGINAL as-loaded basis, not its current remaining balance:
 *   total − Σ(original basis of JE-less opening lots) === GL(DigitalAssets)
 * With consumed carrying `c` and remaining carrying `r` (c + r === original), "total − remaining"
 * only happens to equal "total − original" while c === 0 (untouched legacy lot). The moment FIFO
 * consumes any of a legacy lot (c > 0), `total − r` overstates the GL side by exactly `c` — the
 * GL got that disposal's credit but never the matching opening debit. Only original-basis
 * exclusion is correct in general; "remaining" is a degenerate special case of it.
 * (A zero-basis opening lot stays JE-less too, but original === remaining === 0, so it never
 * needs excluding either way — that's the D2 case below.)
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, markPosted } from '../src/store/eventStore.js';
import { insertLotMovement } from '../src/store/lotMovementStore.js';

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
/** A pre-opening-equity-JE row: movement persisted with je_id NULL, event POSTED, no JE.
 *  Mirrors the exact shape routes.ts wrote before this feature (id/lotSeq/idempotencyKey). */
function seedLegacyOpening(db: Db, id: string, raw: RawOver): void {
  seedAuto(db, id, raw);
  const lotId = `OPEN-${id}`;
  const stamp = `${raw.eventTime as string}|${id}`;
  insertLotMovement(db, {
    id: `lm-${id}-${lotId}`, entityId: E, eventId: id, jeId: null, lotId,
    lotSeq: stamp, periodId: P, coinType: SUI, wallet: '0xacme',
    deltaQtyMinor: raw.quantityMinor as string, deltaCostMinor: raw.openingCostMinor as string,
    costBasisMethod: 'FIFO', policySetVersion: 'demo-ps-1', idempotencyKey: `${id}|${lotId}`,
  });
  markPosted(db, id);
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

  it('JE-backed opening lot joins the FULL identity: total === DigitalAssets GL; OBE carries the credit', async () => {
    const app = await freshApp(); const db = app._db;
    seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: '500000', eventTime: '2026-04-02T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', eventTime: '2026-04-20T00:00:00Z' }));
    expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
    const body = await getLots(app);
    expect(body.simulationGaps).toEqual([]);
    // The opening debit is now IN DigitalAssets, so no exclusion term at all:
    expect(sumRemainingCost(body)).toBe(glBalance(db, 'DigitalAssets') + 0n); // full identity
    // …and the equity offset exists exactly once (DEBIT−CREDIT fold → negative credit balance):
    expect(glBalance(db, 'OpeningBalanceEquity')).toBe(-500000n);
  });

  it('legacy JE-less opening lot, CONSUMED: exclusion must use ORIGINAL basis, not remaining (spec §3.5)', async () => {
    const app = await freshApp(); const db = app._db;
    // Legacy lot is the OLDEST → FIFO consumes it first. 1e9 qty @ 500000 cost; payment takes 4e8
    // → consumed carrying c = 200000, remaining r = 300000. GL got the 200000 disposal credit but
    // never an opening debit, so: total − ORIGINAL(500000) === GL, while total − r misses by c.
    seedLegacyOpening(db, 'legacy1', opening({ eventId: 'legacy1', txDigest: 'DIG-LEG1', openingCostMinor: '500000', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', quantityMinor: '400000000', eventTime: '2026-04-20T00:00:00Z' }));
    expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
    const body = await getLots(app);
    expect(body.simulationGaps).toEqual([]);
    const total = sumRemainingCost(body);
    const gl = glBalance(db, 'DigitalAssets');
    const legacyRemaining = sumRemainingCost(body, (o) => o === 'opening');
    expect(legacyRemaining).toBe(300000n);              // proves FIFO really consumed the legacy lot
    expect(total - 500000n).toBe(gl);                   // ORIGINAL-basis identity holds
    expect(total - legacyRemaining).not.toBe(gl);       // "remaining" breaks by the consumed 200000
  });

  it('zero-basis opening lot stays excluded and harmless (D2)', async () => {
    const app = await freshApp(); const db = app._db;
    seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
    seedAuto(db, 'zero1', opening({ eventId: 'zero1', txDigest: 'DIG-Z1', openingCostMinor: '0', eventTime: '2026-04-02T00:00:00Z' }));
    expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
    const body = await getLots(app);
    // zero basis contributes 0 to both sides — full identity unaffected, no JE, no OBE entry:
    expect(sumRemainingCost(body)).toBe(glBalance(db, 'DigitalAssets'));
    expect(glBalance(db, 'OpeningBalanceEquity')).toBe(0n);
  });
});
