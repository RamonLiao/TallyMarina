/**
 * Monkey / extreme-input tests for disposition + exceptions endpoints.
 * Rule 9: assertions encode WHY each constraint matters for audit integrity,
 * not just what the HTTP status is.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/store/db.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { insertSnapshot, setSnapshotStatus } from '../src/store/snapshotStore.js';

const EID = TEST_ENTITY_ID;

/** Seed a CLASSIFY_REVIEW exception (NEEDS_REVIEW event) and return its exceptionId URL param. */
function seedClassifyReview(db: Db, id: string): string {
  insertEvent(db, { id, entityId: EID, rawJson: JSON.stringify({ kind: 'x', eventTime: '2026-05-01T00:00:00Z' }) });
  setAiSuggestion(db, id, {
    aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
    aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
  });
  return encodeURIComponent(`CLASSIFY_REVIEW:${id}`);
}

describe('monkey: exceptions disposition — extreme inputs', () => {
  let app: FastifyInstance & { _db: Db };

  beforeEach(async () => { app = await buildTestApp(); });

  it('extreme reasonNote (100k chars) is accepted — audit log must store full text for future review', async () => {
    const exId = seedClassifyReview(app._db, 'ev-mono-100k');
    const bigNote = 'A'.repeat(100_000);
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'OTHER', reasonNote: bigNote },
    });
    // The audit log must capture the full auditor note — truncating it would corrupt the audit trail.
    expect(r.statusCode).toBe(200);
    const body = r.json() as { disposition: { reasonNote: string } };
    expect(body.disposition.reasonNote).toBe(bigNote);
  });

  it('rapid consecutive dispositions cannot overwrite a terminal state — prevents audit log tampering', async () => {
    const exId = seedClassifyReview(app._db, 'ev-mono-rapid');

    // First write: terminal transition
    const r1 = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'dismissed', reasonCode: 'IMMATERIAL_WAIVED' },
    });
    expect(r1.statusCode).toBe(200);

    // Immediate second write to terminal: must be rejected — once dismissed, no re-disposition
    // is possible; otherwise an attacker could overwrite the audit log entry.
    const r2 = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    expect(r2.statusCode).toBe(409);
    expect((r2.json() as { error: { code: string } }).error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('forged exceptionId with multiple colons returns 404, not a corrupt parse', async () => {
    // An id like "CAT:ev:extra" could confuse naive split logic and match a wrong event.
    const weirdId = encodeURIComponent('CLASSIFY_REVIEW:ev:extra:colons');
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${weirdId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    // Must reject as not-found (no matching event), not silently succeed or 500.
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('EXCEPTION_NOT_FOUND');
  });

  it('exceptionId with no colon returns 400 VALIDATION', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${encodeURIComponent('NOCATEGORY')}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('empty exceptionId segment returns 400 or 404 — must not reach disposition logic', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${encodeURIComponent(':')}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    // Empty category + empty eventId: event lookup returns null → 404
    expect([400, 404]).toContain(r.statusCode);
  });

  it('missing reasonCode returns 400 VALIDATION — reasonCode is required for audit trail', async () => {
    const exId = seedClassifyReview(app._db, 'ev-mono-noreasoncode');
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved' },
    });
    // Without reasonCode the audit log entry would be incomplete.
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('unknown reasonCode returns 400 VALIDATION — prevents garbage in append-only log', async () => {
    const exId = seedClassifyReview(app._db, 'ev-mono-badreason');
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'INVENTED_CODE' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('two independent categories on the same event can be disposed separately', async () => {
    // Genuine two-category case on a SINGLE event (exercises composite PK independence):
    //   - status AUTO + aiConfidence 0.4 < 0.85 band → LOW_CONFIDENCE_AUTO
    //   - status AUTO + rawJson lacks schemaVersion (malformed NormalizedEvent) → SCHEMA_INVALID
    //     → evaluate() returns REJECTED → RULES_FAILED
    // Both exceptions share the same eventId; the composite PK (category, eventId) must
    // ensure disposing one leaves the other's disposition untouched.
    insertEvent(app._db, { id: 'ev-mono-2cat', entityId: EID, rawJson: JSON.stringify({ kind: 'x', eventTime: '2026-05-01T00:00:00Z' }) });
    setAiSuggestion(app._db, 'ev-mono-2cat', {
      aiEventType: 'UNKNOWN_TYPE', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'AUTO',
    });

    // Verify BOTH categories surface before any disposition.
    const listBefore = await app.inject({
      method: 'GET', url: `/entities/${EID}/exceptions?periodId=2026-Q2`,
    });
    type ExRow = { category: string; eventId: string; disposition: null | { state: string } };
    const bodyBefore = listBefore.json() as { exceptions: ExRow[] };
    const lcaBefore = bodyBefore.exceptions.find((e) => e.category === 'LOW_CONFIDENCE_AUTO' && e.eventId === 'ev-mono-2cat');
    const rfBefore  = bodyBefore.exceptions.find((e) => e.category === 'RULES_FAILED'        && e.eventId === 'ev-mono-2cat');
    expect(lcaBefore, 'LOW_CONFIDENCE_AUTO must surface for AUTO event below confidence band').toBeTruthy();
    expect(rfBefore,  'RULES_FAILED must surface for AUTO event with un-evaluatable rawJson').toBeTruthy();
    expect(lcaBefore?.disposition).toBeNull();
    expect(rfBefore?.disposition).toBeNull();

    // Dispose only LOW_CONFIDENCE_AUTO.
    const exId1 = encodeURIComponent('LOW_CONFIDENCE_AUTO:ev-mono-2cat');
    const r1 = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId1}/disposition`,
      payload: { state: 'deferred', reasonCode: 'PENDING_DOC' },
    });
    expect(r1.statusCode).toBe(200);
    expect((r1.json() as { disposition: { category: string } }).disposition.category).toBe('LOW_CONFIDENCE_AUTO');

    // RULES_FAILED disposition must still be null — composite PK (category, eventId) is independent.
    const listAfter = await app.inject({
      method: 'GET', url: `/entities/${EID}/exceptions?periodId=2026-Q2`,
    });
    const bodyAfter = listAfter.json() as { exceptions: ExRow[] };
    const lcaAfter = bodyAfter.exceptions.find((e) => e.category === 'LOW_CONFIDENCE_AUTO' && e.eventId === 'ev-mono-2cat');
    const rfAfter  = bodyAfter.exceptions.find((e) => e.category === 'RULES_FAILED'        && e.eventId === 'ev-mono-2cat');
    expect(lcaAfter?.disposition?.state).toBe('deferred');
    expect(rfAfter?.disposition).toBeNull();
  });

  it('disposition on an anchored entity returns 409 ANCHORED_READ_ONLY — spec §4 enforcement', async () => {
    // Insert a snapshot and mark it ANCHORED to simulate a completed period anchor.
    insertSnapshot(app._db, {
      id: 'snap-anchored-test', entityId: EID, periodId: '2025-Q4',
      manifestJson: '{}', manifestHash: '0xabc', merkleRoot: '0xdef',
      leafCount: 1, supersedesSeq: null, seq: 1,
    });
    setSnapshotStatus(app._db, 'snap-anchored-test', 'ANCHORED');

    const exId = seedClassifyReview(app._db, 'ev-mono-anchored');
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    // Once anchored, the audit trail is immutable — disposition writes must be rejected
    // to preserve the integrity of the on-chain commitment.
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ANCHORED_READ_ONLY');
  });

  it('decidedBy in request body is ignored — server always uses demo-controller to prevent impersonation', async () => {
    const exId = seedClassifyReview(app._db, 'ev-mono-decidedby');
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED', decidedBy: 'evil-actor' },
    });
    // Even if a client sends decidedBy, the audit log must record the server-assigned actor.
    // This prevents actor impersonation in the append-only audit trail.
    expect(r.statusCode).toBe(200);
    const body = r.json() as { disposition: { decidedBy: string } };
    expect(body.disposition.decidedBy).toBe('demo-controller');
  });
});
