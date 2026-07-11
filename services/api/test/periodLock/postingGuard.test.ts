/**
 * Review C1 (2026-07-03): a LOCKED period must reject new postings and new
 * classification decisions.
 *
 * WHY: the on-chain anchor notarizes the books at close. If run-rules can still
 * insert JEs after lock, the anchored merkle root and the database diverge —
 * the lock is a control that exists on paper only, and the anchor certifies
 * a state the books no longer have.
 */
import { describe, it, expect } from 'vitest';
import { buildTestApp, needsReviewClient, TEST_ENTITY_ID } from '../helpers/app.js';
import { lockPeriod } from '../../src/periodLock/store.js';
import { buildRuleInput } from '../../src/http/buildRuleInput.js';
import { evaluate } from '../../src/deps/rulesEngine.js';
import { getEvent } from '../../src/store/eventStore.js';
import { DEMO_POLICY_SET, buildCoaMapping } from '../../src/http/policyConstants.js';

const ENTITY = encodeURIComponent(TEST_ENTITY_ID);
const PERIOD = '2026-Q2';

function seedLock(db: Parameters<typeof lockPeriod>[0]): void {
  lockPeriod(db, {
    entityId: TEST_ENTITY_ID, periodId: PERIOD,
    lightsSnapshot: '[]', lockedBy: 'test-controller', now: 1,
  });
}

describe('locked period rejects postings (C1)', () => {
  it('run-rules on a LOCKED period → 409 PERIOD_LOCKED, no JEs inserted', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} }); // → AUTO
    seedLock(app._db);
    const r = await app.inject({ method: 'POST', url: `/entities/${ENTITY}/run-rules`, payload: { periodId: PERIOD } });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('PERIOD_LOCKED');
    const j = await app.inject({ method: 'GET', url: `/entities/${ENTITY}/journal` });
    expect((j.json() as { journal: unknown[] }).journal).toHaveLength(0);
  });

  it('decide on a LOCKED period → 409 PERIOD_LOCKED, event stays NEEDS_REVIEW', async () => {
    const app = await buildTestApp(true, needsReviewClient);
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} }); // → NEEDS_REVIEW
    seedLock(app._db);
    const r = await app.inject({
      method: 'POST', url: '/reviews/evt-001/decide',
      payload: { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'X' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('PERIOD_LOCKED');
    expect(getEvent(app._db, 'evt-001')!.status).toBe('NEEDS_REVIEW');
  });

  it('defense-in-depth: the rules engine itself rejects PERIOD_CLOSED when periodOpen=false', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} });
    const ev = getEvent(app._db, 'evt-001')!;
    // evt-001 is a receipt (acquires, never consumes) — the PERIOD_CLOSED gate fires
    // before valuation, so an empty lot pool is irrelevant here.
    const out = evaluate(buildRuleInput(ev, { periodId: PERIOD, periodOpen: false, lots: [], policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping() }));
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.exceptions.map((e) => e.code)).toContain('PERIOD_CLOSED');
  });
});

/**
 * C2 (Task 9, trimmed scope): cockpit/lock require an explicit periodId (no silent
 * DEFAULT_PERIOD fallback), and decide derives its lock scope from the target event's
 * OWN attributed period rather than a caller-supplied or default periodId.
 */
describe('C2: explicit periodId required on cutoff-critical routes', () => {
  it('GET /close-cockpit without periodId → 400 PERIOD_ID_REQUIRED', async () => {
    // WHY: silently defaulting the period on a close-readiness read risks showing
    // the wrong period's lights to a controller who forgot the query param.
    const app = await buildTestApp();
    const r = await app.inject({ method: 'GET', url: `/entities/${ENTITY}/close-cockpit` });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('PERIOD_ID_REQUIRED');
  });

  it('POST /period/lock without periodId → 400 PERIOD_ID_REQUIRED', async () => {
    // WHY: locking the wrong (defaulted) period would notarize the wrong books —
    // the caller must say which period they mean to close.
    const app = await buildTestApp();
    const r = await app.inject({ method: 'POST', url: `/entities/${ENTITY}/period/lock`, payload: {} });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('PERIOD_ID_REQUIRED');
  });

  it('decide derives its lock scope from the event\'s own period: locking the EVENT\'s period → 409 PERIOD_LOCKED', async () => {
    // WHY: re-confirms (on top of the pre-existing DEFAULT_PERIOD-based test above) that
    // the guard is keyed off ev.periodId, not a hardcoded constant — locking exactly the
    // event's own attributed period must block the decision.
    const app = await buildTestApp(true, needsReviewClient);
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} }); // → NEEDS_REVIEW
    const ev = getEvent(app._db, 'evt-001')!;
    expect(ev.periodId).toBe(PERIOD); // fixture's eventTime attributes to 2026-Q2
    seedLock(app._db);
    const r = await app.inject({
      method: 'POST', url: '/reviews/evt-001/decide',
      payload: { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'X' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('PERIOD_LOCKED');
  });

  it('decide is NOT blocked when a DIFFERENT period is locked (caller cannot supply periodId; it must come from the event)', async () => {
    // WHY: proves decide does not fall back to a global/default lock scope — only the
    // event's own period gates it. A lock on an unrelated period must not leak a 409.
    const app = await buildTestApp(true, needsReviewClient);
    await app.inject({ method: 'POST', url: `/entities/${ENTITY}/ingest`, payload: {} }); // → NEEDS_REVIEW
    const ev = getEvent(app._db, 'evt-001')!;
    expect(ev.periodId).toBe(PERIOD);
    lockPeriod(app._db, {
      entityId: TEST_ENTITY_ID, periodId: '2099-Q1',
      lightsSnapshot: '[]', lockedBy: 'test-controller', now: 1,
    });
    const r = await app.inject({
      method: 'POST', url: '/reviews/evt-001/decide',
      payload: { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'X' },
    });
    expect(r.statusCode).toBe(200);
    expect(getEvent(app._db, 'evt-001')!.status).toBe('APPROVED');
  });
});
