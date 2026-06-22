import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity, listEntities, getEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, getEvent, listByStatus, setDecision, markPosted } from '../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { StateError } from '../src/store/stateMachine.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
});

describe('entityStore', () => {
  it('inserts and lists entities', () => {
    expect(listEntities(db)).toHaveLength(1);
    expect(getEntity(db, 'acme:pilot-001')?.displayName).toBe('Acme');
  });
});

describe('eventStore state-gated writes', () => {
  it('setAiSuggestion routes INGESTED -> AUTO and persists ai_* fields', () => {
    insertEvent(db, { id: 'e1', entityId: 'acme:pilot-001', rawJson: '{}' });
    setAiSuggestion(db, 'e1', { aiEventType: 'DIGITAL_ASSET_RECEIPT', aiPurpose: 'X', aiCounterparty: null, aiConfidence: 0.91, aiReasoning: 'r', nextStatus: 'AUTO' });
    const ev = getEvent(db, 'e1')!;
    expect(ev.status).toBe('AUTO');
    expect(ev.aiConfidence).toBeCloseTo(0.91);
    expect(listByStatus(db, 'acme:pilot-001', 'AUTO')).toHaveLength(1);
  });
  it('decide then post follows the legal chain', () => {
    insertEvent(db, { id: 'e2', entityId: 'acme:pilot-001', rawJson: '{}' });
    setAiSuggestion(db, 'e2', { aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null, aiConfidence: 0.5, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW' });
    setDecision(db, 'e2', { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'Z' });
    expect(getEvent(db, 'e2')!.status).toBe('APPROVED');
    markPosted(db, 'e2');
    expect(getEvent(db, 'e2')!.status).toBe('POSTED');
  });
  it('rejects illegal: cannot decide an INGESTED event', () => {
    insertEvent(db, { id: 'e3', entityId: 'acme:pilot-001', rawJson: '{}' });
    expect(() => setDecision(db, 'e3', { finalEventType: 'X', finalPurpose: 'Y' })).toThrowError(StateError);
  });
});

describe('journalStore idempotency', () => {
  it('second insert with same idempotency_key is a no-op duplicate', () => {
    insertEvent(db, { id: 'e4', entityId: 'acme:pilot-001', rawJson: '{}' });
    const row = { id: 'j1', entityId: 'acme:pilot-001', eventId: 'e4', jeJson: '{}', idempotencyKey: 'K1', leafHash: 'abcd' };
    expect(insertJournalEntry(db, row)).toBe('inserted');
    expect(insertJournalEntry(db, { ...row, id: 'j2' })).toBe('duplicate');
    expect(listJournal(db, 'acme:pilot-001')).toHaveLength(1);
  });
});
