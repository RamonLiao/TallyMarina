/**
 * Task 5 (C4 lot store follow-up) — snapshot inclusion pins (spec §3.4, D2).
 *
 * Proves the opening-equity JE (Task 1+2: non-zero OPENING_LOT posts Dr DigitalAssets /
 * Cr OpeningBalanceEquity) actually reaches the merkle spine via POST /entities/:id/snapshot
 * (routes.ts:758+), and that a period whose ONLY event is a zero-basis (JE-less) opening lot
 * still fails loud with EMPTY_SNAPSHOT — it must never silently succeed with an empty/undefined
 * root. These are integration PINS on top of already-shipped Tasks 1-4: if either fails, an
 * earlier task regressed, not this test file.
 *
 * Route gates exercised along the way (Phase 2 B1, spec §4):
 *   - PERIOD_NOT_LOCKED: the period must be LOCKED before /snapshot will build anything.
 *   - EXCEPTIONS_BLOCKING / RECON_BREAKS_BLOCKING: open blockers 409 before EMPTY_SNAPSHOT is
 *     ever reached (checked in that order in the handler).
 *   - The classification/JE/recon/completeness cockpit lights (periodLock/cockpit.ts) gate the
 *     HTTP /period/lock endpoint. jeLight is ENTITY-scoped (listJournal(db, entityId) with no
 *     period filter) and requires jes.length > 0 — in this single-period fixture the JE-less
 *     entity can never satisfy that light, so the zero-basis test locks the period directly via
 *     the periodLock store. (In prod the gate stays reachable over HTTP: an entity with JEs in
 *     an earlier period passes the entity-scoped jeLight while the PERIOD-scoped /snapshot
 *     still finds zero rows.)
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { lockPeriod } from '../src/periodLock/store.js';

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
describe('snapshot inclusion of the opening-equity JE (Task 5, spec §3.4/D2)', () => {
  it('a period with only a non-zero opening lot now snapshots (JE entered the spine)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: '500000' }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);
    expect((rr.json() as { posted: number }).posted).toBe(1); // the opening equity JE actually posted

    const lockR = await app.inject({ method: 'POST', url: `/entities/${E}/period/lock`, payload: { periodId: P } });
    expect(lockR.statusCode, JSON.stringify(lockR.json())).toBe(200);

    const snap = await app.inject({ method: 'POST', url: `/entities/${E}/snapshot`, payload: { periodId: P } });
    expect(snap.statusCode).toBe(200);
    const bodySnap = snap.json() as { snapshot: { status: string; merkleRoot: string; manifestHash: string; leafCount: number } };
    expect(bodySnap.snapshot.status).toBe('FROZEN');
    expect(bodySnap.snapshot.leafCount).toBe(1); // exactly the one opening JE leaf
    expect(bodySnap.snapshot.merkleRoot).toMatch(/^[0-9a-f]{64}$/); // non-empty, real root
    expect(bodySnap.snapshot.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a period with only a ZERO-basis opening lot still fails loud EMPTY_SNAPSHOT (spec §3.4, D2)', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'zero1', opening({ eventId: 'zero1', txDigest: 'DIG-ZERO1', openingCostMinor: '0' }));
    const rr = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(rr.statusCode).toBe(200);
    expect((rr.json() as { posted: number }).posted).toBe(0); // D2: zero-basis stays JE-less

    // For THIS single-period fixture no JE exists entity-wide, so the HTTP /period/lock
    // endpoint's cockpit jeLight (ENTITY-scoped, periodLock/cockpit.ts:34-49) can't go green.
    // The gate is still reachable in prod: a multi-period entity with JEs in an earlier period
    // passes jeLight yet /snapshot (PERIOD-scoped, routes.ts) finds zero rows → EMPTY_SNAPSHOT.
    // Lock directly via the store to reach the gate this test actually targets.
    lockPeriod(db, { entityId: E, periodId: P, lightsSnapshot: '{}', lockedBy: 'test', now: Date.now() });

    const snap = await app.inject({ method: 'POST', url: `/entities/${E}/snapshot`, payload: { periodId: P } });
    expect(snap.statusCode).toBe(409);
    const body = snap.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('EMPTY_SNAPSHOT');
  });
});
