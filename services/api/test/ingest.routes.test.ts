import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/store/db.js';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { lockPeriod } from '../src/periodLock/store.js';

const EID = TEST_ENTITY_ID;

describe('POST /entities/:id/events — HTTP response envelopes', () => {
  let app: FastifyInstance & { _db: Db };

  beforeEach(async () => { app = await buildTestApp(); });

  // WHY: this is the ingest gate's actual HTTP contract — callers integrate against
  // the JSON envelope, not against ingestEvent()'s return value directly.
  it('201 with { eventId, periodId } for a valid event into an OPEN period', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/entities/${EID}/events`,
      payload: { event: { eventTime: '2026-05-01T00:00:00Z' } },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { eventId: string; periodId: string };
    expect(body.periodId).toBe('2026-Q2');
    expect(typeof body.eventId).toBe('string');
  });

  // WHY: a locked period must surface as a structured 409, not a raw thrown error —
  // callers need periodId/eventTime in `details` to explain the rejection to a human.
  it('409 PERIOD_LOCKED_FOR_DATE when the target period is LOCKED', async () => {
    lockPeriod(app._db, { entityId: EID, periodId: '2026-Q1', lightsSnapshot: '{}', lockedBy: 'tester', now: Date.now() });
    const r = await app.inject({
      method: 'POST',
      url: `/entities/${EID}/events`,
      payload: { event: { eventTime: '2026-02-01T00:00:00Z' } },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string; message: string; details: { periodId: string; eventTime: string } } };
    expect(body.error.code).toBe('PERIOD_LOCKED_FOR_DATE');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual({ periodId: '2026-Q1', eventTime: '2026-02-01T00:00:00Z' });
  });

  // WHY: a payload with no eventTime must fail loud as a client error (400), not
  // surface as an opaque 500 from an uncaught period-derivation error.
  it('400 INVALID_EVENT_TIME when rawJson has no eventTime', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/entities/${EID}/events`,
      payload: { event: { foo: 'bar' } },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_EVENT_TIME');
    expect(typeof body.error.message).toBe('string');
  });

  // WHY (review MINOR): an empty/missing body currently throws inside
  // JSON.stringify(req.body.event) when req.body is null/undefined, producing an
  // opaque 500 instead of a client-actionable 400. Fail loud, not crash.
  it('400 (not 500) when the request body is empty', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/entities/${EID}/events`,
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_EVENT_TIME');
  });
});
