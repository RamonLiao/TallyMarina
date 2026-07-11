/**
 * Task 3 (read-path switchover): run-rules stamps each posted JE row with the
 * policy_set_version / rule_version that were ACTUALLY used to evaluate it —
 * read from the persisted policy_sets / coa_mapping_sets tables (Task 2 loaders),
 * never from the DEMO_POLICY_SET constant. This is the audit trail that lets a
 * later policy edit (Task 4/5) be traced back to which JEs it did or didn't affect.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';

const E = 'e1';
const P = '2026-Q2';

interface RawOver { [k: string]: unknown }

function opening(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: '0x2::sui::SUI',
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '500000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
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

describe('run-rules stamps JE rows with the persisted policy/rule version (Task 3)', () => {
  it('journal_entries.policy_set_version / rule_version match the DB-loaded active policy', async () => {
    const app = await freshApp();
    const db = app._db;
    seedAuto(db, 'open1', opening({ eventId: 'open1' }));

    const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r.statusCode).toBe(200);

    const row = db.prepare('SELECT policy_set_version, rule_version FROM journal_entries LIMIT 1').get() as { policy_set_version: string; rule_version: string };
    expect(row.policy_set_version).toBe('demo-ps-1');
    expect(row.rule_version).toBe('demo-rule-1');
  });
});
