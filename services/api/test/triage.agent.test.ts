import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { seedEntity, seedSnapshot } from './helpers.js';
import { cfg } from './helpers/app.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import type { Exception } from '../src/exceptions/types.js';
import { applyDisposition } from '../src/exceptions/disposition.js';
import { lockPeriod } from '../src/periodLock/store.js';
import { insertProposal, decideProposal, listProposals } from '../src/store/proposalStore.js';
import { validateProposal, runTriageOnce } from '../src/triage/agent.js';

const E = 'acme:pilot-001';
const P = '2026-Q2';

// NEEDS_REVIEW event → CLASSIFY_REVIEW exception in collectExceptions.
function seedReviewEvent(db: Db, id: string, amount = '100') {
  db.prepare(
    "INSERT INTO events (id, entity_id, raw_json, ai_event_type, ai_confidence, ai_reasoning, status) VALUES (?, ?, ?, 'DIGITAL_ASSET_RECEIPT', 0.4, 'unsure', 'NEEDS_REVIEW')",
  ).run(id, E, JSON.stringify({ eventType: 'DIGITAL_ASSET_RECEIPT', amount, entityId: E }));
}

const ex = (over: Partial<Exception> = {}): Exception => ({
  exceptionId: 'CLASSIFY_REVIEW:ev-1', category: 'CLASSIFY_REVIEW', eventId: 'ev-1',
  severity: 2, reason: 'r', amount: '100', ai: null, ...over,
});

const good = { action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'why', confidence: 0.8 };

// HONEST mock: echoes the real exceptionId from the prompt; throws if the prompt shape changed.
function proposingClient(payload: Record<string, unknown> = good): GeminiClient {
  return {
    async generateJson(_m: string, prompt: string) {
      if (!/exceptionId/.test(prompt)) throw new Error('triage stub: prompt no longer carries exceptionId');
      return payload as never;
    },
  };
}

describe('validateProposal (deterministic fail-closed)', () => {
  const T = 1000;
  it('accepts a well-formed proposal', () => {
    expect(validateProposal(ex(), good, T)).toEqual({ ok: true, value: good });
  });
  it.each([
    ['bad action', { ...good, action: 'nuked' }],
    ['bad reasonCode', { ...good, reasonCode: 'YOLO' }],
    ['OTHER without note', { ...good, reasonCode: 'OTHER', reasonNote: null }],
    ['rationale too long', { ...good, rationale: 'x'.repeat(2001) }],
    ['note too long', { ...good, reasonCode: 'OTHER', reasonNote: 'x'.repeat(501) }],
    ['confidence out of range', { ...good, confidence: 1.5 }],
    ['confidence non-number', { ...good, confidence: 'high' }],
    ['missing rationale', { ...good, rationale: '' }],
  ])('rejects %s', (_label, raw) => {
    expect(validateProposal(ex(), raw, T).ok).toBe(false);
  });
  it('forbids dismissed on RULES_FAILED (CPA F6)', () => {
    const r = validateProposal(ex({ category: 'RULES_FAILED', exceptionId: 'RULES_FAILED:ev-1' }), { ...good, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }, T);
    expect(r.ok).toBe(false);
  });
  it.each([
    ['dismissed above threshold', { ...good, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }, '5000'],
    ['IMMATERIAL_WAIVED above threshold', { ...good, reasonCode: 'IMMATERIAL_WAIVED' }, '5000'],
    ['dismissed with unknown amount (fail-closed)', { ...good, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }, null],
    ['dismissed with non-numeric amount (fail-closed)', { ...good, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }, 'lots'],
  ])('materiality gate (CPA F5): rejects %s', (_l, raw, amount) => {
    expect(validateProposal(ex({ amount }), raw, T).ok).toBe(false);
  });
  it('materiality gate allows small dismissed', () => {
    expect(validateProposal(ex({ amount: '5' }), { ...good, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }, T).ok).toBe(true);
  });
});

describe('runTriageOnce', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    seedEntity(db, E);
    seedReviewEvent(db, 'ev-1');
  });

  it('proposes for an open exception and is idempotent while proposal is open', async () => {
    const s1 = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s1.proposed).toBe(1);
    expect(listProposals(db, E, 'proposed').length).toBe(1);
    const s2 = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s2.proposed).toBe(0);
    expect(s2.skipped).toBeGreaterThan(0);
  });

  it('skips non-open exceptions (dispositioned) — I1', async () => {
    applyDisposition(db, { entityId: E, category: 'CLASSIFY_REVIEW', eventId: 'ev-1', to: 'resolved', reasonCode: 'RECLASSIFIED', decidedBy: 'demo-controller', now: 1 });
    const s = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s.proposed).toBe(0);
  });

  it('cooldown: skips exceptions with a rejected proposal (CPA F9)', async () => {
    const p = insertProposal(db, { exceptionId: 'CLASSIFY_REVIEW:ev-1', eventId: 'ev-1', entityId: E, periodId: P, action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null, rationale: 'r', confidence: 0.5, model: 'm', createdAt: 1 });
    decideProposal(db, p.id, 'rejected', 'demo-controller', null, 2);
    const s = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s.proposed).toBe(0);
  });

  it('whole round skips when period locked (CPA F8c)', async () => {
    // A NEEDS_REVIEW event blocks lock via cockpit lights, so lock the period directly at the store level.
    lockPeriod(db, { entityId: E, periodId: P, lightsSnapshot: '[]', lockedBy: 'demo-controller', now: 1 });
    const s = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s.roundSkipped).toBe('PERIOD_LOCKED');
    expect(s.scanned).toBe(0);
  });

  it('whole round skips when entity anchored (I2)', async () => {
    seedSnapshot(db, { id: 's1', entityId: E, periodId: P, status: 'ANCHORED' });
    const s = await runTriageOnce({ db, cfg, client: proposingClient() }, E, P);
    expect(s.roundSkipped).toBe('ANCHORED');
  });

  it('invalid LLM output is discarded (failed++), never stored', async () => {
    const s = await runTriageOnce({ db, cfg, client: proposingClient({ action: 'nuked', reasonCode: 'YOLO', rationale: 'x', confidence: 99 }) }, E, P);
    expect(s.failed).toBe(1);
    expect(listProposals(db, E).length).toBe(0);
  });

  it('a throwing LLM call does not abort the round', async () => {
    seedReviewEvent(db, 'ev-2');
    let n = 0;
    const flaky: GeminiClient = {
      async generateJson(_m: string, _p: string) {
        n++;
        if (n === 1) throw new Error('boom');
        return good as never;
      },
    };
    const s = await runTriageOnce({ db, cfg, client: flaky }, E, P);
    expect(s.failed).toBe(1);
    expect(s.proposed).toBe(1);
  });
});
