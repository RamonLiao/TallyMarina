import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { openDb } from '../src/store/db.js';
import { seed } from '../src/store/seed.js';
import { insertProposal, decideProposal } from '../src/store/proposalStore.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { LocalMemory } from '../src/triage/memory/localMemory.js';
import type { MemoryClient } from '../src/triage/memory/types.js';

const require = createRequire(import.meta.url);
const fixture = require('../src/fixtures/acme-pilot-001.events.json') as unknown;

function freshDb() {
  const db = openDb(':memory:');
  seed(db, { entityId: 'acme-pilot-001', entityChainId: 'c', entityCapId: 'k', originalPackageId: 'p' }, fixture as never);
  return db;
}
const feat = { eventType: 'RECEIPT', category: 'RULES_FAILED', amountBand: '1e3' };

describe('OffMemory', () => {
  it('recall → [] and remember → resolves (noop)', async () => {
    const m: MemoryClient = new OffMemory();
    expect(await m.recall({ entityId: 'e', query: 'q', features: feat, limit: 5 })).toEqual({ hits: [], servedBy: 'off' });
    await expect(m.remember({ entityId: 'e', record: {} as never })).resolves.toBeUndefined();
    await expect(m.probe()).resolves.toBeUndefined();
    await expect(m.close()).resolves.toBeUndefined();
  });
});

describe('LocalMemory', () => {
  it('recalls same-entity decided proposals of the matching category', async () => {
    const db = freshDb();
    // seed one decided proposal (event id must exist in fixture — use a real one)
    const evId = (db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string }).id;
    const row = insertProposal(db, {
      exceptionId: `RULES_FAILED:${evId}`, eventId: evId, entityId: 'acme-pilot-001', periodId: '2026-07',
      action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'r', confidence: 0.5, model: 'm', createdAt: 1,
    });
    decideProposal(db, row.id, 'accepted', 'human', null, 2);
    const m: MemoryClient = new LocalMemory(db, 5);
    const { hits, servedBy } = await m.recall({ entityId: 'acme-pilot-001', query: 'q', features: { eventType: null, category: 'RULES_FAILED', amountBand: 'UNKNOWN' }, limit: 5 });
    expect(servedBy).toBe('local');
    expect(hits.length).toBe(1);
    expect(hits[0]?.text).toContain('[ACCEPTED]');
    expect(hits[0]?.text).toContain('RULES_FAILED');
  });

  it('does not leak another entity\'s memory', async () => {
    const db = freshDb();
    const evId = (db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string }).id;
    const row = insertProposal(db, {
      exceptionId: `RULES_FAILED:${evId}`, eventId: evId, entityId: 'acme-pilot-001', periodId: '2026-07',
      action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'r', confidence: 0.5, model: 'm', createdAt: 1,
    });
    decideProposal(db, row.id, 'accepted', 'human', null, 2);
    const m: MemoryClient = new LocalMemory(db, 5);
    const { hits } = await m.recall({ entityId: 'OTHER-CO', query: 'q', features: { eventType: null, category: 'RULES_FAILED', amountBand: 'UNKNOWN' }, limit: 5 });
    expect(hits).toEqual([]);
  });

  it('ignores still-open (undecided) proposals', async () => {
    const db = freshDb();
    const evId = (db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string }).id;
    insertProposal(db, {
      exceptionId: `RULES_FAILED:${evId}`, eventId: evId, entityId: 'acme-pilot-001', periodId: '2026-07',
      action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'r', confidence: 0.5, model: 'm', createdAt: 1,
    });
    const m: MemoryClient = new LocalMemory(db, 5);
    const { hits } = await m.recall({ entityId: 'acme-pilot-001', query: 'q', features: { eventType: null, category: 'RULES_FAILED', amountBand: 'UNKNOWN' }, limit: 5 });
    expect(hits).toEqual([]);
  });
});
