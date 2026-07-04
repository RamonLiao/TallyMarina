import { describe, it, expect, vi } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID } from './helpers.js';
import { insertProposal, getProposal, type ProposalRow } from '../src/store/proposalStore.js';
import type { Db } from '../src/store/db.js';
import type { MemoryClient, MemoryRecord } from '../src/triage/memory/types.js';

const P = '2026-Q2';

function recordingMemory(sink: MemoryRecord[]): MemoryClient {
  return {
    recall: async () => ({ hits: [], servedBy: 'off' }),
    probe: async () => {},
    close: async () => {},
    remember: vi.fn(async ({ record }: { record: MemoryRecord }) => { sink.push(record); }),
  };
}

function throwingMemory(): MemoryClient {
  return {
    recall: async () => ({ hits: [], servedBy: 'off' }),
    probe: async () => {},
    close: async () => {},
    remember: async () => { throw new Error('relayer down'); },
  };
}

function seedReviewEvent(db: Db, id: string, amount = '100') {
  db.prepare(
    "INSERT INTO events (id, entity_id, raw_json, ai_event_type, ai_confidence, ai_reasoning, status) VALUES (?, ?, ?, 'DIGITAL_ASSET_RECEIPT', 0.4, 'unsure', 'NEEDS_REVIEW')",
  ).run(id, TEST_ENTITY_ID, JSON.stringify({ eventType: 'DIGITAL_ASSET_RECEIPT', amount, entityId: TEST_ENTITY_ID }));
}

function seedProposal(db: Db, eventId: string, over: Partial<ProposalRow> = {}): ProposalRow {
  return insertProposal(db, {
    exceptionId: `CLASSIFY_REVIEW:${eventId}`, eventId, entityId: TEST_ENTITY_ID, periodId: P,
    action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null,
    rationale: 'needs doc', confidence: 0.8, model: 'm2', createdAt: 1, ...over,
  });
}

// buildTestApp(false) seeds nothing (not even the entity); FK is ON. seedReviewEvent
// self-seeds via routes.test.ts convention — but that file's ensureEntity isn't exported,
// so insert the entity here directly.
function ensureEntity(db: Db) {
  db.prepare(
    "INSERT OR IGNORE INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, 'd', '0xchain', '0xcap', '0xpkg')",
  ).run(TEST_ENTITY_ID);
}

describe('write-back remember', () => {
  it('reject fires remember with REJECTED record + note (fire-and-forget, route still 200)', async () => {
    const sink: MemoryRecord[] = [];
    const memory = recordingMemory(sink);
    const app = await buildTestApp(false, undefined, memory);
    ensureEntity(app._db);
    seedReviewEvent(app._db, 'ev-rej1');
    const p = seedProposal(app._db, 'ev-rej1');

    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/reject`, payload: { note: 'nope' } });

    expect(res.statusCode).toBe(200);
    expect(getProposal(app._db, p.id)?.status).toBe('rejected');
    // fire-and-forget: give the microtask queue a tick to let the .then() land.
    await new Promise((r) => setTimeout(r, 0));
    expect(sink).toHaveLength(1);
    expect(sink[0]?.outcome).toBe('REJECTED');
    expect(sink[0]?.note).toBe('nope');
    expect(sink[0]?.entityId).toBe(TEST_ENTITY_ID);
    expect(sink[0]?.category).toBe('CLASSIFY_REVIEW');
    expect(sink[0]?.action).toBe('deferred');
    expect(sink[0]?.reasonCode).toBe('PENDING_DOC');
  });

  it('reject fails open when the live exception is already gone (no remember call, still 200)', async () => {
    const sink: MemoryRecord[] = [];
    const memory = recordingMemory(sink);
    const app = await buildTestApp(false, undefined, memory);
    ensureEntity(app._db);
    seedReviewEvent(app._db, 'ev-rej2');
    const p = seedProposal(app._db, 'ev-rej2');
    // Decide the event out of NEEDS_REVIEW so the CLASSIFY_REVIEW exception disappears
    // from the live projection before reject runs.
    app._db.prepare(
      "UPDATE events SET status = 'APPROVED', final_event_type = 'DIGITAL_ASSET_RECEIPT', final_purpose = 'x' WHERE id = 'ev-rej2'",
    ).run();

    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/reject`, payload: { note: 'gone' } });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(sink).toHaveLength(0);
  });

  it('accept success fires remember with ACCEPTED record (route 200)', async () => {
    const sink: MemoryRecord[] = [];
    const memory = recordingMemory(sink);
    const app = await buildTestApp(false, undefined, memory);
    ensureEntity(app._db);
    seedReviewEvent(app._db, 'ev-acc1');
    const p = seedProposal(app._db, 'ev-acc1');

    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });

    expect(res.statusCode).toBe(200);
    expect(getProposal(app._db, p.id)?.status).toBe('accepted');
    await new Promise((r) => setTimeout(r, 0));
    expect(sink).toHaveLength(1);
    expect(sink[0]?.outcome).toBe('ACCEPTED');
    expect(sink[0]?.note).toBeNull();
    expect(sink[0]?.entityId).toBe(TEST_ENTITY_ID);
    expect(sink[0]?.action).toBe('deferred');
    expect(sink[0]?.reasonCode).toBe('PENDING_DOC');
  });

  it('memwal remember throwing does NOT fail the route on reject (still 200)', async () => {
    const app = await buildTestApp(false, undefined, throwingMemory());
    ensureEntity(app._db);
    seedReviewEvent(app._db, 'ev-rej3');
    const p = seedProposal(app._db, 'ev-rej3');

    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/reject`, payload: { note: 'x' } });

    expect(res.statusCode).toBe(200);
    expect(getProposal(app._db, p.id)?.status).toBe('rejected');
  });

  it('memwal remember throwing does NOT fail the route on accept (still 200)', async () => {
    const app = await buildTestApp(false, undefined, throwingMemory());
    ensureEntity(app._db);
    seedReviewEvent(app._db, 'ev-acc2');
    const p = seedProposal(app._db, 'ev-acc2');

    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });

    expect(res.statusCode).toBe(200);
    expect(getProposal(app._db, p.id)?.status).toBe('accepted');
  });
});
