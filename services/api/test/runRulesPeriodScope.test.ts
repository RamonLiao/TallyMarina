/**
 * Final whole-branch review (2026-07-04), Important finding: run-rules'
 * candidate query (`listByStatus(..., 'APPROVED')` ∪ `listByStatus(..., 'AUTO')`)
 * is entity-wide with NO period filter, while `periodOpen` is computed once for
 * the REQUEST's periodId and each posted JE is tagged with the EVENT's own
 * periodId. A run-rules call for period X could therefore sweep an eligible
 * event that actually belongs to a different, LOCKED period Y — evaluating it
 * under X's periodOpen and posting a JE tagged periodId=Y. Neither the route's
 * lock guard nor the rules engine's PERIOD_CLOSED gate is keyed to Y, so the
 * lock is bypassed.
 *
 * WHY this matters: a locked period is supposed to be immutable once closed and
 * anchored. If a same-entity run-rules call for an unrelated period can still
 * post into it, the anchored merkle root and the books diverge silently.
 */
import { describe, it, expect } from 'vitest';
import { buildTestApp, stubClassifyClient, TEST_ENTITY_ID } from './helpers/app.js';
import { lockPeriod } from '../src/periodLock/store.js';
import { listJournal } from '../src/store/journalStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';

const ENTITY = encodeURIComponent(TEST_ENTITY_ID);

// Fixture's evt-001/evt-002 are both dated in 2026-Q2 (June 2026). We ingest one
// extra raw event dated in 2026-Q1 so the entity has candidates in two periods.
const q1RawEvent = {
  schemaVersion: 'v1',
  eventId: 'evt-q1-fixture',
  eventType: 'DIGITAL_ASSET_RECEIPT',
  eventGroupId: null,
  entityId: TEST_ENTITY_ID,
  bookId: 'main',
  wallet: '0xacmeTreasury',
  counterparty: '0xcustomerQ1',
  coinType: '0x2::sui::SUI',
  assetDecimals: 9,
  quantityMinor: '2500000000',
  eventTime: '2026-02-01T00:00:00Z', // → 2026-Q1
  economicPurpose: 'RECEIVABLE_SETTLEMENT',
  ownershipChange: true,
  considerationAsset: null,
  considerationQtyMinor: null,
  considerationDecimals: null,
  rawPayloadHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  txDigest: 'DEMOReceiptQ1',
  eventIndex: 0,
};

describe('run-rules multi-period lock integrity (C2 final review)', () => {
  it('run-rules for 2026-Q2 does not sweep a LOCKED 2026-Q1 event into a posted JE', async () => {
    const app = await buildTestApp(true, stubClassifyClient);

    // Precondition the pre-registry system never had: the SUI asset the q1 event carries
    // must have a registered scale for the ingest gate to admit it. Registering it does not
    // weaken the gate — the event's assetDecimals (9) still has to match this registry row.
    registerTestAsset(app._db, TEST_ENTITY_ID, '0x2::sui::SUI', 9);

    // Seed a Q1 event and drive it to AUTO (high-confidence stub client + allow-listed
    // raw type DIGITAL_ASSET_RECEIPT with LLM agreement satisfies the deterministic
    // AUTO gate).
    const ingestRes = await app.inject({
      method: 'POST',
      url: `/entities/${ENTITY}/events`,
      payload: { event: q1RawEvent },
    });
    expect(ingestRes.statusCode).toBe(201);
    const { eventId: q1EventId, periodId: q1PeriodId } = ingestRes.json() as { eventId: string; periodId: string };
    expect(q1PeriodId).toBe('2026-Q1');
    const classifyRes = await app.inject({ method: 'POST', url: `/events/${q1EventId}/classify`, payload: {} });
    expect((classifyRes.json() as { event: { status: string } }).event.status).toBe('AUTO');

    // Fixture's evt-001/evt-002 auto-classify to AUTO on ingest (stubClassifyClient).
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} });

    // Lock Q1 — its books are supposed to be immutable now.
    lockPeriod(app._db, {
      entityId: TEST_ENTITY_ID, periodId: '2026-Q1',
      lightsSnapshot: '[]', lockedBy: 'test-controller', now: 1,
    });

    // Run rules for Q2 only.
    const r = await app.inject({ method: 'POST', url: `/entities/${ENTITY}/run-rules`, payload: { periodId: '2026-Q2' } });
    expect(r.statusCode).toBe(200);

    const journal = listJournal(app._db, TEST_ENTITY_ID);

    // The locked Q1 event must NOT have been swept and posted by the Q2 run.
    expect(journal.some((je) => je.periodId === '2026-Q1')).toBe(false);
    expect(journal.some((je) => je.eventId === q1EventId)).toBe(false);

    // The run must still work for its own (open) period.
    expect(journal.some((je) => je.periodId === '2026-Q2')).toBe(true);
  });
});
