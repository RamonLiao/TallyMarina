import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { seedEntity } from './helpers.js';
import {
  insertProposal, getProposal, getOpenProposal, hasRejectedProposal,
  listProposals, decideProposal, revertAcceptedToStale, markEntityProposalsStale,
  type ProposalRow,
} from '../src/store/proposalStore.js';

const E = 'acme:pilot-001';
const P = '2026-Q2';

function seedEvent(db: Db, id: string) {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, '{}', 'AUTO')").run(id, E);
}

function mk(db: Db, exceptionId = 'CLASSIFY_REVIEW:ev-1', eventId = 'ev-1'): ProposalRow {
  return insertProposal(db, {
    exceptionId, eventId, entityId: E, periodId: P,
    action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null,
    rationale: 'needs invoice doc', confidence: 0.8, model: 'm2', createdAt: 111,
  });
}

describe('proposalStore', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    seedEntity(db, E);
    seedEvent(db, 'ev-1');
    seedEvent(db, 'ev-2');
  });

  it('insert returns row with proposed status and reads back', () => {
    const p = mk(db);
    expect(p.status).toBe('proposed');
    expect(getProposal(db, p.id)?.rationale).toBe('needs invoice doc');
    expect(getOpenProposal(db, 'CLASSIFY_REVIEW:ev-1')?.id).toBe(p.id);
  });

  it('partial unique index: second proposed for same exception throws', () => {
    mk(db);
    expect(() => mk(db)).toThrow();
  });

  it('after reject, a new proposed row is allowed and hasRejectedProposal is true', () => {
    const p = mk(db);
    expect(decideProposal(db, p.id, 'rejected', 'demo-controller', 'wrong reason', 222)).toBe(true);
    expect(hasRejectedProposal(db, 'CLASSIFY_REVIEW:ev-1')).toBe(true);
    const p2 = mk(db); // index only constrains status='proposed'
    expect(p2.id).not.toBe(p.id);
  });

  it('CAS: decide on non-proposed returns false (terminal states immutable)', () => {
    const p = mk(db);
    expect(decideProposal(db, p.id, 'accepted', 'demo-controller', null, 222)).toBe(true);
    expect(decideProposal(db, p.id, 'rejected', 'demo-controller', null, 333)).toBe(false);
    expect(decideProposal(db, p.id, 'stale', 'demo-controller', null, 333)).toBe(false);
    expect(getProposal(db, p.id)?.status).toBe('accepted');
    expect(getProposal(db, p.id)?.decidedBy).toBe('demo-controller');
  });

  it('revertAcceptedToStale flips accepted → stale', () => {
    const p = mk(db);
    decideProposal(db, p.id, 'accepted', 'demo-controller', null, 222);
    revertAcceptedToStale(db, p.id, 333);
    expect(getProposal(db, p.id)?.status).toBe('stale');
  });

  it('markEntityProposalsStale sweeps only proposed rows of the entity/period', () => {
    const p1 = mk(db, 'CLASSIFY_REVIEW:ev-1', 'ev-1');
    const p2 = mk(db, 'RULES_FAILED:ev-2', 'ev-2');
    decideProposal(db, p2.id, 'rejected', 'demo-controller', null, 222);
    const n = markEntityProposalsStale(db, E, P, 'demo-controller', 333);
    expect(n).toBe(1);
    expect(getProposal(db, p1.id)?.status).toBe('stale');
    expect(getProposal(db, p2.id)?.status).toBe('rejected'); // untouched
  });

  it('listProposals filters by status, defaults to all', () => {
    const p1 = mk(db, 'CLASSIFY_REVIEW:ev-1', 'ev-1');
    mk(db, 'RULES_FAILED:ev-2', 'ev-2');
    decideProposal(db, p1.id, 'rejected', 'demo-controller', null, 222);
    expect(listProposals(db, E).length).toBe(2);
    expect(listProposals(db, E, 'proposed').length).toBe(1);
    expect(listProposals(db, E, 'rejected').length).toBe(1);
  });

  it('log table gets one row per lifecycle change', () => {
    const p = mk(db);
    decideProposal(db, p.id, 'rejected', 'demo-controller', 'nope', 222);
    const logs = db.prepare('SELECT * FROM triage_proposal_log WHERE proposal_id = ? ORDER BY seq').all(p.id) as Array<Record<string, unknown>>;
    expect(logs.map((l) => l.status)).toEqual(['proposed', 'rejected']);
    expect(logs[1]!.decision_note).toBe('nope');
  });
});
