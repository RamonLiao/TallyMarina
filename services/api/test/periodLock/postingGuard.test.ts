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
    const out = evaluate(buildRuleInput(ev, { periodId: PERIOD, periodOpen: false }));
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.exceptions.map((e) => e.code)).toContain('PERIOD_CLOSED');
  });
});
