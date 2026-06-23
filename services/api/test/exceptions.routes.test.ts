import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/store/db.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { upsertReconDisposition } from '../src/store/reconBreakStore.js';

const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xusdc::usdc::USDC',
  '0xacmeTreasury|0xweth::weth::WETH',
  '0xacmeTreasury|0xusdt::usdt::USDT',
];
function dismissReconBreaks(db: Db, entityId: string, periodId: string) {
  for (const key of RECON_BREAKS) {
    const [wallet, coinType] = key.split('|');
    upsertReconDisposition(db, { entityId, periodId, wallet, coinType, state: 'dismissed', reasonCode: 'IMMATERIAL_WAIVED', reasonNote: null, decidedBy: 'test', decidedAt: Date.now() });
  }
}

const EID = TEST_ENTITY_ID; // 'acme:pilot-001' — matches fixture rawJson entityId

describe('exceptions routes + close gate', () => {
  let app: FastifyInstance & { _db: Db };

  beforeEach(async () => { app = await buildTestApp(); });

  it('GET /entities/:id/exceptions returns categorized list + summary', async () => {
    // Seed a NEEDS_REVIEW event so collectExceptions surfaces CLASSIFY_REVIEW
    insertEvent(app._db, { id: 'ev-nr1', entityId: EID, rawJson: JSON.stringify({ kind: 'x' }) });
    setAiSuggestion(app._db, 'ev-nr1', {
      aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    });

    const r = await app.inject({ method: 'GET', url: `/entities/${EID}/exceptions?periodId=2026-Q2` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { exceptions: unknown[]; summary: { blocking: number; open: number } };
    expect(body).toHaveProperty('exceptions');
    expect(body.summary).toHaveProperty('blocking');
    expect(body.exceptions.length).toBeGreaterThanOrEqual(1);
    expect(body.summary.blocking).toBeGreaterThanOrEqual(1); // CLASSIFY_REVIEW is blocking
  });

  it('POST disposition rejects forged exceptionId with 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/exceptions/${encodeURIComponent('RULES_FAILED:does-not-exist')}/disposition`,
      payload: { state: 'dismissed', reasonCode: 'OTHER', reasonNote: 'x' },
    });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('EXCEPTION_NOT_FOUND');
  });

  it('POST disposition rejects illegal transition with 409', async () => {
    // Create a real CLASSIFY_REVIEW exception: NEEDS_REVIEW event
    insertEvent(app._db, { id: 'ev-t1', entityId: EID, rawJson: JSON.stringify({ kind: 'x' }) });
    setAiSuggestion(app._db, 'ev-t1', {
      aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    });

    const exId = encodeURIComponent('CLASSIFY_REVIEW:ev-t1');

    // First disposition: open → resolved (legal)
    const r1 = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'resolved', reasonCode: 'RECLASSIFIED' },
    });
    expect(r1.statusCode).toBe(200);

    // Second disposition: resolved → deferred (illegal — resolved is terminal)
    const r2 = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'deferred', reasonCode: 'PENDING_DOC' },
    });
    expect(r2.statusCode).toBe(409);
    expect((r2.json() as { error: { code: string } }).error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('close gate: open blocking exception → /snapshot 409 EXCEPTIONS_BLOCKING; dispose → snapshot proceeds', async () => {
    // Produce real journal entries: classify fixture events (high-confidence AUTO) + run-rules.
    // buildTestApp seeds fixture events 'evt-001' and 'evt-002' via seed() for entity 'acme:pilot-001'.
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    const rrRes = await app.inject({
      method: 'POST', url: `/entities/${EID}/run-rules`, payload: { periodId: '2026-Q2' },
    });
    const rrBody = rrRes.json() as { posted: number; skipped: number };
    // Guard: if run-rules didn't post anything the snapshot would fail for an unrelated reason.
    expect(rrBody.posted).toBeGreaterThanOrEqual(1);

    // Seed a CLASSIFY_REVIEW exception (NEEDS_REVIEW event = blocking)
    insertEvent(app._db, { id: 'ev-gate1', entityId: EID, rawJson: JSON.stringify({ kind: 'x' }) });
    setAiSuggestion(app._db, 'ev-gate1', {
      aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    });

    // Snapshot must be blocked by the CLASSIFY_REVIEW exception
    const snap1 = await app.inject({
      method: 'POST', url: `/entities/${EID}/snapshot`,
      payload: { periodId: '2026-Q2' },
    });
    expect(snap1.statusCode).toBe(409);
    expect((snap1.json() as { error: { code: string } }).error.code).toBe('EXCEPTIONS_BLOCKING');

    // Dispose the blocking exception (dismissed is non-open, gate passes)
    const exId = encodeURIComponent('CLASSIFY_REVIEW:ev-gate1');
    const disp = await app.inject({
      method: 'POST',
      url: `/exceptions/${exId}/disposition`,
      payload: { state: 'dismissed', reasonCode: 'IMMATERIAL_WAIVED' },
    });
    expect(disp.statusCode).toBe(200);

    // Dismiss recon breaks so the recon gate also passes
    dismissReconBreaks(app._db, EID, '2026-Q2');

    // Now snapshot should proceed (both gates pass, journal entries exist from run-rules)
    const snap2 = await app.inject({
      method: 'POST', url: `/entities/${EID}/snapshot`,
      payload: { periodId: '2026-Q2' },
    });
    expect(snap2.statusCode).toBe(200);
    expect((snap2.json() as { snapshot: { status: string } }).snapshot.status).toBe('FROZEN');
  });

  it('LOW_CONFIDENCE_AUTO open does NOT block close', async () => {
    // Seed an AUTO event with confidence < 0.85 (LOW_CONFIDENCE_AUTO, advisory only)
    insertEvent(app._db, { id: 'ev-lo1', entityId: EID, rawJson: JSON.stringify({ kind: 'x' }) });
    setAiSuggestion(app._db, 'ev-lo1', {
      aiEventType: 'DIGITAL_ASSET_RECEIPT', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.8, aiReasoning: 'r', nextStatus: 'AUTO',
    });

    // Verify LOW_CONFIDENCE_AUTO is never counted as a blocker in close-readiness
    const cr = await app.inject({
      method: 'GET', url: `/entities/${EID}/close-readiness?periodId=2026-Q2`,
    });
    expect(cr.statusCode).toBe(200);
    const crBody = cr.json() as { exceptions: { blocking: number; blockers: Array<{ category: string }> }; recon: { blocking: number; blockers: string[] }; closeable: boolean };
    // RULES_FAILED may appear (ev-lo1 is AUTO with unmappable payload), but LOW_CONFIDENCE_AUTO
    // must never appear in exceptions.blockers. This asserts the advisory-only constraint.
    expect(crBody.exceptions.blockers.every((b) => b.category !== 'LOW_CONFIDENCE_AUTO')).toBe(true);

    // Verify LOW_CONFIDENCE_AUTO is surfaced in the exceptions list (it IS an exception, just advisory)
    const ex = await app.inject({
      method: 'GET', url: `/entities/${EID}/exceptions?periodId=2026-Q2`,
    });
    const exBody = ex.json() as { exceptions: Array<{ category: string }> };
    expect(exBody.exceptions.some((e) => e.category === 'LOW_CONFIDENCE_AUTO')).toBe(true);
  });
});
