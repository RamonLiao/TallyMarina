/**
 * Task 5 (C4 lot store): simulateLots replays POSTED events chronologically through
 * evaluate with CURRENT policy (periodOpen: true) — the drift probe. It answers
 * "what would today's rules produce", maintaining an in-memory lot pool per
 * (wallet, coinType). Non-POSTABLE replays are recorded in simulationGaps, never thrown,
 * never faked as zeros. Read-only: it must never write.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { foldRemainingLots } from '../src/store/lotMovementStore.js';
import { simulateLots } from '../src/lots/simulate.js';

const E = 'e1';
const P = '2026-Q2';

interface RawOver { [k: string]: unknown }

function baseEvent(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: '0x2::sui::SUI',
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-10T00:00:00Z',
    economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function opening(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'OPENING_LOT', economicPurpose: 'OPENING_BALANCE', openingCostMinor: '500000', ...over });
}
function payment(over: RawOver = {}): RawOver {
  return baseEvent({ eventType: 'DIGITAL_ASSET_PAYMENT', economicPurpose: 'VENDOR_PAYMENT', quantityMinor: '400000000', ...over });
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

describe('simulateLots — replay POSTED events through current rules (C4 Task 5)', () => {
  it('reproduces the persisted fold exactly when nothing has drifted', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });

    const { lots, simulationGaps } = simulateLots(db, E);
    expect(simulationGaps).toEqual([]);
    // Persisted fold: one OPEN- lot, qty 6e8, cost 3e5 (500000 * 6/10).
    const persisted = foldRemainingLots(db, E, '0xacme', '0x2::sui::SUI');
    expect(persisted).toHaveLength(1);
    const p = persisted[0]!;
    const s = lots.get(p.lotId)!;
    expect(s.qtyMinor).toBe(p.remainingQtyMinor);
    expect(s.costMinor).toBe(p.costMinor);
    expect(s.wallet).toBe('0xacme');
    expect(s.coinType).toBe('0x2::sui::SUI');
  });

  it('records a non-POSTABLE replay as a gap — never throws, never fakes zeros', async () => {
    const app = await freshApp();
    const db = app._db;
    // A lone payment with no opening lot: evaluate returns INSUFFICIENT_LOT (not POSTABLE).
    // Force it to POSTED directly (run-rules would never post it) so replay must confront it.
    insertEvent(db, { id: 'orphan', entityId: E, rawJson: JSON.stringify(payment({ eventId: 'orphan', eventTime: '2026-04-02T00:00:00Z' })) });
    db.prepare(`UPDATE events SET status = 'POSTED' WHERE id = ?`).run('orphan');

    const { lots, simulationGaps } = simulateLots(db, E);
    expect(simulationGaps).toContain('orphan');
    expect(lots.size).toBe(0); // no fabricated lot for the unsimulatable event
  });

  it('is read-only: replay mutates no rows', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1', eventTime: '2026-04-01T00:00:00Z' }));
    seedAuto(db, 'pay1', payment({ eventId: 'pay1', eventTime: '2026-04-05T00:00:00Z' }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });

    const before = db.prepare('SELECT id, delta_qty_minor, delta_cost_minor FROM lot_movement ORDER BY id').all();
    simulateLots(db, E);
    const after = db.prepare('SELECT id, delta_qty_minor, delta_cost_minor FROM lot_movement ORDER BY id').all();
    expect(after).toEqual(before);
  });
});
