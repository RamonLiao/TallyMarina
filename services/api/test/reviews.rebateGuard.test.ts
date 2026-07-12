/**
 * Spec §4.3 (v2.2 follow-up, ledger "finalPurpose 翻轉守衛"): NETWORK_FEE_REBATE is
 * normalization's SIGN marker for a negative-net gas event, not a classification judgment —
 * quantityMinor's schema forces a positive integer, so the direction of the net amount travels
 * ONLY in economicPurpose, and gasRules branches on it into the §4.4.1 rebate accounting
 * (contra-expense + income + new lot) vs the ordinary fee-spend template.
 *
 * WHY this matters (Rule 9): buildRuleInput feeds `finalPurpose ?? raw.economicPurpose` to the
 * engine, so a human decide could silently flip the branch in either direction — booking a net
 * INFLOW as a fee spend (FIFO-consuming lots that were never spent), or fabricating rebate
 * income and a lot from a genuine outflow. The guard is symmetric and fail-closed: a decision
 * may never ADD or REMOVE the marker relative to the normalized payload (400
 * REBATE_MARKER_IMMUTABLE); everything else about the decision stays free.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, getEvent } from '../src/store/eventStore.js';

const E = 'e1';
const COIN = '0xneg::coin::COIN';

interface RawOver { [k: string]: unknown }
function gasEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'GAS_FEE', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: COIN,
    assetDecimals: 0, quantityMinor: '2', eventTime: '2026-04-10T00:00:00Z',
    economicPurpose: 'NETWORK_FEE', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  return app;
}
/** Seed an event stuck in NEEDS_REVIEW so /decide's state machine accepts a decision. */
function seedNeedsReview(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.5, aiReasoning: 'seed', nextStatus: 'NEEDS_REVIEW',
  });
}
async function decide(app: FastifyInstance, eventId: string, finalPurpose: string) {
  const r = await app.inject({
    method: 'POST', url: `/reviews/${eventId}/decide`,
    payload: { finalEventType: 'GAS_FEE', finalPurpose },
  });
  return { status: r.statusCode, body: r.json() as { error?: { code: string } } };
}

describe('decide guard: NETWORK_FEE_REBATE marker is immutable (spec §4.3)', () => {
  it('dropping the marker from a rebate-marked gas event → 400 REBATE_MARKER_IMMUTABLE, event stays NEEDS_REVIEW', async () => {
    const app = await freshApp();
    seedNeedsReview(app._db, 'g1', gasEvent({ economicPurpose: 'NETWORK_FEE_REBATE' }));
    const r = await decide(app, 'g1', 'NETWORK_FEE');
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('REBATE_MARKER_IMMUTABLE');
    expect(getEvent(app._db, 'g1')!.status).toBe('NEEDS_REVIEW'); // decision rejected, not half-applied
  });

  it('minting the marker onto an ordinary gas event → 400 REBATE_MARKER_IMMUTABLE', async () => {
    const app = await freshApp();
    seedNeedsReview(app._db, 'g2', gasEvent());
    const r = await decide(app, 'g2', 'NETWORK_FEE_REBATE');
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('REBATE_MARKER_IMMUTABLE');
  });

  it('minting the marker onto a payload with NO economicPurpose at all → still 400 (monkey: absent field is not a loophole)', async () => {
    const app = await freshApp();
    const raw = gasEvent();
    delete raw.economicPurpose;
    seedNeedsReview(app._db, 'g3', raw);
    const r = await decide(app, 'g3', 'NETWORK_FEE_REBATE');
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('REBATE_MARKER_IMMUTABLE');
  });

  it('a rebate-marked event decided WITH the marker kept → 200 APPROVED (guard restricts the marker, not the review)', async () => {
    const app = await freshApp();
    seedNeedsReview(app._db, 'g4', gasEvent({ economicPurpose: 'NETWORK_FEE_REBATE' }));
    const r = await decide(app, 'g4', 'NETWORK_FEE_REBATE');
    expect(r.status).toBe(200);
    expect(getEvent(app._db, 'g4')!.status).toBe('APPROVED');
  });

  it('an ordinary event re-purposed WITHOUT touching the marker → 200 (no collateral restriction)', async () => {
    const app = await freshApp();
    seedNeedsReview(app._db, 'g5', gasEvent());
    const r = await decide(app, 'g5', 'TREASURY_OPS');
    expect(r.status).toBe(200);
    expect(getEvent(app._db, 'g5')!.status).toBe('APPROVED');
  });
});
