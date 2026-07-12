/**
 * §4.4.1 (D9): negative-net GAS_FEE events (economicPurpose 'NETWORK_FEE_REBATE') cap their
 * GasFeeExpense contra at the as-of-this-event cumulative GasFeeExpense balance, in
 * event-time order. This exercises the run-rules loop's accumulator (routes.ts) end to end:
 * a positive gas-fee event recognizes GasFeeExpense, then a later negative-net event's
 * contra/income split must reflect exactly that prior recognition — never a DB-wide or
 * out-of-order total. A second run-rules call over the same (now-posted) event set must
 * reproduce byte-identical journal output (decision: POSTABLE events only post once;
 * idempotent replay).
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';

const E = 'e1';
const P = '2026-Q2';
const COIN = '0xneg::coin::COIN';

interface RawOver { [k: string]: unknown }

function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'GAS_FEE', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: COIN,
    assetDecimals: 0, quantityMinor: '1', eventTime: '2026-04-10T00:00:00Z',
    economicPurpose: 'NETWORK_FEE', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}

function opening(over: RawOver = {}): RawOver {
  return baseEvent({
    eventType: 'OPENING_LOT', economicPurpose: 'OPENING_BALANCE',
    quantityMinor: '1000', openingCostMinor: '1000', ...over,
  });
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
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

function jeLines(db: Db, eventId: string): Array<{ account: string; side: string; amountMinor: string; leg: string }> {
  const row = db.prepare('SELECT je_json FROM journal_entries WHERE event_id = ?').get(eventId) as { je_json: string } | undefined;
  if (!row) return [];
  return (JSON.parse(row.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; leg: string }> }).lines;
}

describe('§4.4.1 negative-net GAS_FEE — as-of accumulator (D9)', () => {
  it('as-of ordering: negative-net contra reflects ONLY the prior gas-fee event, capped at its balance', async () => {
    const app = await freshApp();
    const db = app._db;
    // buildRuleInput hard-stubs price at unitPriceMinor '100' (assetDecimals 0 here → FV = qty*100).
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    // Positive gas fee: quantityMinor '1' → FV 100 → Dr GasFeeExpense 100. gasExpenseToDate becomes 100.
    seedAuto(db, 'gasPos', baseEvent({ eventId: 'gasPos', eventTime: '2026-04-05T00:00:00Z', quantityMinor: '1', txDigest: 'DIGPOS' }));
    // Negative net: quantityMinor '2' → FV 200, gasExpenseToDate at this point = 100 (not-including-self).
    // contra = min(200, 100) = 100; income (GasRebateIncome) = 100.
    seedAuto(db, 'gasNeg', baseEvent({
      eventId: 'gasNeg', eventTime: '2026-04-10T00:00:00Z', quantityMinor: '2',
      economicPurpose: 'NETWORK_FEE_REBATE', txDigest: 'DIGNEG',
    }));

    const r1 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().posted).toBeGreaterThan(0);

    const posLines = jeLines(db, 'gasPos');
    expect(posLines.find((l) => l.leg === 'NETWORK_FEE')).toMatchObject({ account: 'GasFeeExpense', side: 'DEBIT', amountMinor: '100' });

    const negLines = jeLines(db, 'gasNeg');
    expect(negLines.find((l) => l.leg === 'ACQUISITION')).toMatchObject({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '200' });
    expect(negLines.find((l) => l.leg === 'REBATE_CONTRA')).toMatchObject({ account: 'GasFeeExpense', side: 'CREDIT', amountMinor: '100' });
    expect(negLines.find((l) => l.leg === 'REBATE_INCOME')).toMatchObject({ account: 'GasRebateIncome', side: 'CREDIT', amountMinor: '100' });

    // Determinism (D9): a second run-rules call over the SAME event set (now all posted —
    // candidates is APPROVED/AUTO only, so this call finds nothing new) reproduces a
    // byte-identical journal — no re-derivation drift in the accumulator on replay.
    const journalAfterRun1 = r1.json().journal;
    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().posted).toBe(0);
    expect(r2.json().journal).toEqual(journalAfterRun1);
  });

  it('regression: positive gas fee event is unaffected by the negative-net accumulator wiring', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'gasPos', baseEvent({ eventId: 'gasPos', eventTime: '2026-04-05T00:00:00Z', quantityMinor: '1', txDigest: 'DIGPOS' }));
    const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r.statusCode).toBe(200);
    const lines = jeLines(db, 'gasPos');
    expect(lines.find((l) => l.leg === 'NETWORK_FEE')).toMatchObject({ account: 'GasFeeExpense', side: 'DEBIT', amountMinor: '100' });
    expect(lines.find((l) => l.leg === 'DISPOSAL')).toMatchObject({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '1' });
  });
});
