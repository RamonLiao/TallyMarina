import type { Db } from './db.js';
import type { ReasonCode } from '../exceptions/types.js';

export type ProposalAction = 'resolved' | 'deferred' | 'dismissed';
export type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'stale';

export interface ProposalRow {
  id: number; exceptionId: string; eventId: string; entityId: string; periodId: string;
  action: ProposalAction; reasonCode: ReasonCode; reasonNote: string | null;
  rationale: string; confidence: number; status: ProposalStatus; model: string;
  createdAt: number; decidedBy: string | null; decidedAt: number | null; decisionNote: string | null;
  recallContext: string | null;
}

function map(r: Record<string, unknown>): ProposalRow {
  return {
    id: r.id as number, exceptionId: r.exception_id as string, eventId: r.event_id as string,
    entityId: r.entity_id as string, periodId: r.period_id as string,
    action: r.action as ProposalAction, reasonCode: r.reason_code as ReasonCode,
    reasonNote: (r.reason_note as string | null) ?? null, rationale: r.rationale as string,
    confidence: r.confidence as number, status: r.status as ProposalStatus, model: r.model as string,
    createdAt: r.created_at as number, decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as number | null) ?? null, decisionNote: (r.decision_note as string | null) ?? null,
    recallContext: (r.recall_context as string | null) ?? null,
  };
}

function log(db: Db, p: { id: number; exceptionId: string; entityId: string }, status: string, decidedBy: string | null, decisionNote: string | null, at: number): void {
  db.prepare(
    'INSERT INTO triage_proposal_log (proposal_id, exception_id, entity_id, status, decided_by, decision_note, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(p.id, p.exceptionId, p.entityId, status, decidedBy, decisionNote, at);
}

export function insertProposal(
  db: Db,
  p: Omit<ProposalRow, 'id' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'recallContext'> & { recallContext?: string | null },
): ProposalRow {
  let row!: ProposalRow;
  db.transaction(() => {
    const res = db.prepare(
      `INSERT INTO triage_proposal (exception_id, event_id, entity_id, period_id, action, reason_code, reason_note, rationale, confidence, status, model, created_at, recall_context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`,
    ).run(p.exceptionId, p.eventId, p.entityId, p.periodId, p.action, p.reasonCode, p.reasonNote, p.rationale, p.confidence, p.model, p.createdAt, p.recallContext ?? null);
    const id = Number(res.lastInsertRowid);
    log(db, { id, exceptionId: p.exceptionId, entityId: p.entityId }, 'proposed', null, null, p.createdAt);
    row = getProposal(db, id)!;
  })();
  return row;
}

export function getProposal(db: Db, id: number): ProposalRow | null {
  const r = db.prepare('SELECT * FROM triage_proposal WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function getOpenProposal(db: Db, exceptionId: string): ProposalRow | null {
  const r = db.prepare("SELECT * FROM triage_proposal WHERE exception_id = ? AND status = 'proposed'").get(exceptionId) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function hasRejectedProposal(db: Db, exceptionId: string): boolean {
  return db.prepare("SELECT 1 FROM triage_proposal WHERE exception_id = ? AND status = 'rejected' LIMIT 1").get(exceptionId) !== undefined;
}

export function listProposals(db: Db, entityId: string, status?: ProposalStatus): ProposalRow[] {
  const rows = status
    ? db.prepare('SELECT * FROM triage_proposal WHERE entity_id = ? AND status = ? ORDER BY id').all(entityId, status)
    : db.prepare('SELECT * FROM triage_proposal WHERE entity_id = ? ORDER BY id').all(entityId);
  return (rows as Record<string, unknown>[]).map(map);
}

/** CAS proposed→{accepted|rejected|stale}. Returns false if the proposal was not in 'proposed'. */
export function decideProposal(db: Db, id: number, to: 'accepted' | 'rejected' | 'stale', decidedBy: string, decisionNote: string | null, now: number): boolean {
  let ok = false;
  db.transaction(() => {
    const res = db.prepare(
      "UPDATE triage_proposal SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'proposed'",
    ).run(to, decidedBy, now, decisionNote, id);
    ok = res.changes === 1;
    if (ok) {
      const p = getProposal(db, id)!;
      log(db, p, to, decidedBy, decisionNote, now);
    }
  })();
  return ok;
}

/** Correction path: accept CAS succeeded but applyDisposition rejected the transition. */
export function revertAcceptedToStale(db: Db, id: number, now: number): void {
  db.transaction(() => {
    const res = db.prepare("UPDATE triage_proposal SET status = 'stale', decided_at = ? WHERE id = ? AND status = 'accepted'").run(now, id);
    if (res.changes === 1) {
      const p = getProposal(db, id)!;
      log(db, p, 'stale', p.decidedBy, 'disposition transition rejected', now);
    }
  })();
}

/** Bulk sweep at period lock / anchor. periodId null = all periods for the entity. */
export function markEntityProposalsStale(db: Db, entityId: string, periodId: string | null, decidedBy: string, now: number): number {
  let count = 0;
  db.transaction(() => {
    const open = (periodId
      ? db.prepare("SELECT * FROM triage_proposal WHERE entity_id = ? AND period_id = ? AND status = 'proposed'").all(entityId, periodId)
      : db.prepare("SELECT * FROM triage_proposal WHERE entity_id = ? AND status = 'proposed'").all(entityId)
    ) as Record<string, unknown>[];
    for (const r of open.map(map)) {
      if (decideProposal(db, r.id, 'stale', decidedBy, 'period locked/anchored', now)) count++;
    }
  })();
  return count;
}
