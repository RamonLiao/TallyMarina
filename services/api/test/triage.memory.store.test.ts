import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { seedEntity } from './helpers.js';
import { insertProposal, getProposal } from '../src/store/proposalStore.js';

const E = 'acme:pilot-001';
const P = '2026-Q2';

function seedEvent(db: Db, id: string) {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, '{}', 'AUTO')").run(id, E);
}

const base = {
  exceptionId: 'RULES_FAILED:evt-1', eventId: 'evt-1', entityId: E, periodId: P,
  action: 'deferred' as const, reasonCode: 'PENDING_DOC' as const, reasonNote: null,
  rationale: 'r', confidence: 0.5, model: 'm', createdAt: 1,
};

describe('proposal recall_context', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    seedEntity(db, E);
    seedEvent(db, 'evt-1');
  });

  it('stores and reads back recall_context JSON', () => {
    const row = insertProposal(db, { ...base, recallContext: '{"mode":"local","hits":[]}' });
    expect(getProposal(db, row.id)!.recallContext).toBe('{"mode":"local","hits":[]}');
  });

  it('defaults to null when omitted (round-1 callers unchanged)', () => {
    const row = insertProposal(db, base);
    expect(getProposal(db, row.id)!.recallContext).toBeNull();
  });
});
