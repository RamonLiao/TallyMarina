import type { Db } from './db.js';
import type { DispositionState, DispositionSource, ReasonCode } from '../exceptions/types.js';

export interface DispositionRow {
  category: string; eventId: string; entityId: string;
  state: DispositionState; reasonCode: ReasonCode; reasonNote: string | null;
  decidedBy: string; decidedAt: number;
  source: DispositionSource; proposalId: number | null;
}

function map(r: Record<string, unknown>): DispositionRow {
  return {
    category: r.category as string,
    eventId: r.event_id as string,
    entityId: r.entity_id as string,
    state: r.state as DispositionState,
    reasonCode: r.reason_code as ReasonCode,
    reasonNote: (r.reason_note as string | null) ?? null,
    decidedBy: r.decided_by as string,
    decidedAt: r.decided_at as number,
    source: (r.source as DispositionSource) ?? 'HUMAN',
    proposalId: (r.proposal_id as number | null) ?? null,
  };
}

export function getDisposition(db: Db, category: string, eventId: string): DispositionRow | null {
  const r = db.prepare('SELECT * FROM exception_disposition WHERE category = ? AND event_id = ?').get(category, eventId) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listDispositions(db: Db, entityId: string): DispositionRow[] {
  return (db.prepare('SELECT * FROM exception_disposition WHERE entity_id = ?').all(entityId) as Record<string, unknown>[]).map(map);
}

export function upsertDisposition(db: Db, row: DispositionRow): void {
  db.prepare(
    `INSERT INTO exception_disposition (category, event_id, entity_id, state, reason_code, reason_note, decided_by, decided_at, source, proposal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category, event_id) DO UPDATE SET
       state=excluded.state, reason_code=excluded.reason_code, reason_note=excluded.reason_note,
       decided_by=excluded.decided_by, decided_at=excluded.decided_at,
       source=excluded.source, proposal_id=excluded.proposal_id`,
  ).run(row.category, row.eventId, row.entityId, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt, row.source, row.proposalId);
}

export function appendDispositionLog(db: Db, row: DispositionRow): void {
  db.prepare(
    `INSERT INTO exception_disposition_log (category, event_id, entity_id, state, reason_code, reason_note, decided_by, decided_at, source, proposal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.category, row.eventId, row.entityId, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt, row.source, row.proposalId);
}
