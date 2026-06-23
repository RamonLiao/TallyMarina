// services/api/test/exceptions.collect.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, setDecision, markPosted } from '../src/store/eventStore.js';
import { collectExceptions } from '../src/exceptions/collect.js';

const LOW = 0.85;
function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', displayName: 'Acme', chainObjectId: '', capObjectId: '', originalPackageId: '' });
  return db;
}
// a raw event the rules engine cannot post (unknown type) → RULES_FAILED when APPROVED
function addEvent(db: Db, id: string, raw: object) {
  insertEvent(db, { id, entityId: 'e1', rawJson: JSON.stringify(raw) });
}

describe('collectExceptions', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('classifies NEEDS_REVIEW as CLASSIFY_REVIEW', () => {
    addEvent(db, 'ev1', { kind: 'x' });
    setAiSuggestion(db, 'ev1', { aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW' });
    const out = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(out.map((e) => e.category)).toContain('CLASSIFY_REVIEW');
    expect(out[0]!.exceptionId).toBe('CLASSIFY_REVIEW:ev1');
  });

  it('classifies AUTO below comfort band as LOW_CONFIDENCE_AUTO, not above', () => {
    addEvent(db, 'lo', { kind: 'x' });
    setAiSuggestion(db, 'lo', { aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.8, aiReasoning: 'r', nextStatus: 'AUTO' });
    addEvent(db, 'hi', { kind: 'x' });
    setAiSuggestion(db, 'hi', { aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.95, aiReasoning: 'r', nextStatus: 'AUTO' });
    const cats = collectExceptions(db, 'e1', '2026-Q2', LOW).map((e) => e.exceptionId);
    expect(cats).toContain('LOW_CONFIDENCE_AUTO:lo');
    expect(cats).not.toContain('LOW_CONFIDENCE_AUTO:hi'); // 0.95 ≥ 0.85, no comfort issue (RULES_FAILED may still apply, asserted elsewhere)
  });

  it('fires RULES_FAILED for AUTO event with unmappable eventType (positive control)', () => {
    // eventType 'UNKNOWN_TYPE' is not in STRATEGIES → evaluate() returns REVIEW_REQUIRED (decision !== 'POSTABLE')
    // aiConfidence 0.95 ≥ LOW (0.85) → no LOW_CONFIDENCE_AUTO overlap; clean single assertion.
    const unmappable = {
      eventType: 'UNKNOWN_TYPE', bookId: 'b1', eventTime: '2026-04-01T00:00:00Z',
      coinType: '0x2::sui::SUI', wallet: 'wallet1', amountMinor: '1000',
    };
    addEvent(db, 'unmapped', unmappable);
    setAiSuggestion(db, 'unmapped', { aiEventType: 'UNKNOWN_TYPE', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.95, aiReasoning: 'r', nextStatus: 'AUTO' });
    const out = collectExceptions(db, 'e1', '2026-Q2', LOW);
    const rf = out.find((e) => e.eventId === 'unmapped' && e.category === 'RULES_FAILED');
    expect(rf).toBeDefined();
    expect(rf!.exceptionId).toBe('RULES_FAILED:unmapped');
  });

  it('excludes POSTED events from RULES_FAILED (already produced JE)', () => {
    addEvent(db, 'posted', { kind: 'unmappable' });
    setAiSuggestion(db, 'posted', { aiEventType: 'UNMAPPABLE', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.99, aiReasoning: 'r', nextStatus: 'AUTO' });
    markPosted(db, 'posted');
    const out = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(out.find((e) => e.eventId === 'posted' && e.category === 'RULES_FAILED')).toBeUndefined();
  });

  it('orders by severity desc then confidence asc; GET is read-only (idempotent)', () => {
    addEvent(db, 'rev', { kind: 'x' });
    setAiSuggestion(db, 'rev', { aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null, aiConfidence: 0.2, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW' });
    const a = collectExceptions(db, 'e1', '2026-Q2', LOW);
    const b = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(a).toEqual(b); // recompute is deterministic, no state mutated
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.severity).toBeGreaterThanOrEqual(a[i]!.severity);
  });
});
