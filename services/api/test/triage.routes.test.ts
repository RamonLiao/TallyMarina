import { describe, it, expect } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID, seedSnapshot } from './helpers.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { insertProposal, getProposal, type ProposalRow } from '../src/store/proposalStore.js';
import { lockPeriod } from '../src/periodLock/store.js';
import type { Db } from '../src/store/db.js';

const P = '2026-Q2';

// buildTestApp(false) seeds NOTHING (not even the entity) and foreign_keys=ON,
// so this helper self-seeds the entity idempotently before inserting the event.
function ensureEntity(db: Db) {
  db.prepare(
    "INSERT OR IGNORE INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, 'd', '0xchain', '0xcap', '0xpkg')",
  ).run(TEST_ENTITY_ID);
}

function seedReviewEvent(db: Db, id: string, amount = '100') {
  ensureEntity(db);
  db.prepare(
    "INSERT INTO events (id, entity_id, raw_json, ai_event_type, ai_confidence, ai_reasoning, status, period_id) VALUES (?, ?, ?, 'DIGITAL_ASSET_RECEIPT', 0.4, 'unsure', 'NEEDS_REVIEW', ?)",
  ).run(id, TEST_ENTITY_ID, JSON.stringify({ eventType: 'DIGITAL_ASSET_RECEIPT', amount, entityId: TEST_ENTITY_ID }), P);
}

function seedProposal(db: Db, eventId: string, over: Partial<ProposalRow> = {}): ProposalRow {
  return insertProposal(db, {
    exceptionId: `CLASSIFY_REVIEW:${eventId}`, eventId, entityId: TEST_ENTITY_ID, periodId: P,
    action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null,
    rationale: 'needs doc', confidence: 0.8, model: 'm2', createdAt: 1, ...over,
  });
}

const triageClient: GeminiClient = {
  async generateJson(_m: string, prompt: string) {
    if (!/exceptionId/.test(prompt)) throw new Error('triage stub: unexpected prompt');
    return { action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'why', confidence: 0.8 } as never;
  },
};

describe('triage routes', () => {
  it('POST run proposes; GET lists proposed by default', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t1');
    const run = await app.inject({ method: 'POST', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/run`, payload: { periodId: P } });
    expect(run.statusCode).toBe(200);
    expect(run.json().run.proposed).toBe(1);
    const list = await app.inject({ method: 'GET', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/proposals` });
    expect(list.json().proposals).toHaveLength(1);
    expect(list.json().proposals[0].status).toBe('proposed');
  });

  it('accept happy path: disposition lands with AGENT_PROPOSAL provenance, proposal accepted', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t2');
    const p = seedProposal(app._db, 'ev-t2');
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(200);
    expect(res.json().disposition.state).toBe('deferred');
    const log = app._db.prepare('SELECT source, proposal_id FROM exception_disposition_log WHERE event_id = ?').all('ev-t2') as Array<Record<string, unknown>>;
    expect(log[0]).toEqual({ source: 'AGENT_PROPOSAL', proposal_id: p.id });
    expect(getProposal(app._db, p.id)?.status).toBe('accepted');
    // double-accept → 409 PROPOSAL_NOT_OPEN
    const again = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('PROPOSAL_NOT_OPEN');
  });

  it('accept on anchored entity → 409 ANCHORED_READ_ONLY and proposal swept stale (B1/I2)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t3');
    const p = seedProposal(app._db, 'ev-t3');
    seedSnapshot(app._db, { id: 's1', entityId: TEST_ENTITY_ID, periodId: P, status: 'ANCHORED' });
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ANCHORED_READ_ONLY');
    expect(getProposal(app._db, p.id)?.status).toBe('stale');
  });

  it('accept when exception no longer current → 409 PROPOSAL_STALE, proposal stale (I3)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t4');
    const p = seedProposal(app._db, 'ev-t4');
    // decide the event out of NEEDS_REVIEW → CLASSIFY_REVIEW exception disappears from projection
    app._db.prepare("UPDATE events SET status = 'APPROVED', final_event_type = 'DIGITAL_ASSET_RECEIPT', final_purpose = 'x' WHERE id = 'ev-t4'").run();
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PROPOSAL_STALE');
    expect(getProposal(app._db, p.id)?.status).toBe('stale');
  });

  it('accept resolved×RULES_FAILED while rule still fails → 409 STILL_FAILING (CPA F7)', async () => {
    const app = await buildTestApp(false, triageClient);
    ensureEntity(app._db);
    // APPROVED with a type the rules engine cannot post → RULES_FAILED in projection
    app._db.prepare(
      "INSERT INTO events (id, entity_id, raw_json, final_event_type, final_purpose, status, period_id) VALUES ('ev-t5', ?, ?, 'DIGITAL_ASSET_RECEIPT', 'x', 'APPROVED', ?)",
    ).run(TEST_ENTITY_ID, JSON.stringify({ eventType: 'DIGITAL_ASSET_RECEIPT', entityId: 'WRONG-ENTITY' }), P);
    const p = insertProposal(app._db, {
      exceptionId: 'RULES_FAILED:ev-t5', eventId: 'ev-t5', entityId: TEST_ENTITY_ID, periodId: P,
      action: 'resolved', reasonCode: 'MAPPING_ADDED', reasonNote: null, rationale: 'mapping added', confidence: 0.9, model: 'm2', createdAt: 1,
    });
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STILL_FAILING');
    expect(getProposal(app._db, p.id)?.status).toBe('proposed'); // untouched, human can fix mapping then re-accept
  });

  it('accept: non-transition applyDisposition failure reverts proposal to stale, not left accepted (final-review Finding 1)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t5b');
    const p = seedProposal(app._db, 'ev-t5b');
    // Force applyDisposition to throw something other than ILLEGAL_TRANSITION by
    // breaking the table it writes to. decideProposal(…'accepted') still succeeds
    // (different table), so this reproduces "accepted, then write blows up".
    app._db.exec('ALTER TABLE exception_disposition RENAME TO exception_disposition_x');
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(500);
    app._db.exec('ALTER TABLE exception_disposition_x RENAME TO exception_disposition');
    expect(getProposal(app._db, p.id)?.status).toBe('stale');
    const rows = app._db.prepare('SELECT * FROM exception_disposition WHERE event_id = ?').all('ev-t5b');
    expect(rows).toHaveLength(0);
  });

  it('reject records optional note (CPA F10); unknown id 404', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t6');
    const p = seedProposal(app._db, 'ev-t6');
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/reject`, payload: { note: 'not a duplicate' } });
    expect(res.statusCode).toBe(200);
    expect(getProposal(app._db, p.id)?.status).toBe('rejected');
    expect(getProposal(app._db, p.id)?.decisionNote).toBe('not a duplicate');
    const missing = await app.inject({ method: 'POST', url: '/triage/proposals/99999/reject' });
    expect(missing.statusCode).toBe(404);
  });

  it('run with bogus periodId → 400 VALIDATION (F1a: single-period demo, blocks lock-sweep-dodge probe)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t8');
    const res = await app.inject({ method: 'POST', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/run`, payload: { periodId: 'FAKE' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('run with non-string periodId → 400 VALIDATION (F3)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t9');
    const res = await app.inject({ method: 'POST', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/run`, payload: { periodId: { $ne: null } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('reject with numeric note → 400 VALIDATION (F3), not a 500 from better-sqlite3', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t10');
    const p = seedProposal(app._db, 'ev-t10');
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/reject`, payload: { note: 123 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('accept a proposal whose period is locked → 409 PERIOD_LOCKED, proposal staled (F1b defense-in-depth)', async () => {
    const app = await buildTestApp(false, triageClient);
    seedReviewEvent(app._db, 'ev-t11');
    const p = seedProposal(app._db, 'ev-t11');
    lockPeriod(app._db, { entityId: TEST_ENTITY_ID, periodId: P, lightsSnapshot: '[]', lockedBy: 'demo-controller', now: Date.now() });
    const res = await app.inject({ method: 'POST', url: `/triage/proposals/${p.id}/accept` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PERIOD_LOCKED');
    expect(getProposal(app._db, p.id)?.status).toBe('stale');
  });

  it('run returns 409 TRIAGE_BUSY when a run is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: GeminiClient = {
      async generateJson() { await gate; return { action: 'deferred', reasonCode: 'PENDING_DOC', rationale: 'r', confidence: 0.5 } as never; },
    };
    const app = await buildTestApp(false, slow);
    seedReviewEvent(app._db, 'ev-t7');
    const first = app.inject({ method: 'POST', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/run`, payload: { periodId: P } });
    await new Promise((r) => setTimeout(r, 20)); // let first run enter the LLM call
    const second = await app.inject({ method: 'POST', url: `/entities/${encodeURIComponent(TEST_ENTITY_ID)}/triage/run`, payload: { periodId: P } });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('TRIAGE_BUSY');
    release();
    expect((await first).statusCode).toBe(200);
  });
});
