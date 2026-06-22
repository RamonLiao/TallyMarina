import type { Db } from './db.js';
import { assertEventTransition, type EventStatus } from './stateMachine.js';

export interface EventRow {
  id: string; entityId: string; rawJson: string;
  aiEventType: string | null; aiPurpose: string | null; aiCounterparty: string | null;
  aiConfidence: number | null; aiReasoning: string | null;
  finalEventType: string | null; finalPurpose: string | null;
  status: EventStatus;
}

function map(r: Record<string, unknown>): EventRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, rawJson: r.raw_json as string,
    aiEventType: (r.ai_event_type as string | null) ?? null,
    aiPurpose: (r.ai_purpose as string | null) ?? null,
    aiCounterparty: (r.ai_counterparty as string | null) ?? null,
    aiConfidence: (r.ai_confidence as number | null) ?? null,
    aiReasoning: (r.ai_reasoning as string | null) ?? null,
    finalEventType: (r.final_event_type as string | null) ?? null,
    finalPurpose: (r.final_purpose as string | null) ?? null,
    status: r.status as EventStatus,
  };
}

export function insertEvent(db: Db, e: { id: string; entityId: string; rawJson: string }): void {
  db.prepare('INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, ?)')
    .run(e.id, e.entityId, e.rawJson, 'INGESTED');
}

export function getEvent(db: Db, id: string): EventRow | null {
  const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listEvents(db: Db, entityId: string): EventRow[] {
  return (db.prepare('SELECT * FROM events WHERE entity_id = ? ORDER BY id').all(entityId) as Record<string, unknown>[]).map(map);
}

export function listByStatus(db: Db, entityId: string, status: EventStatus): EventRow[] {
  return (db.prepare('SELECT * FROM events WHERE entity_id = ? AND status = ? ORDER BY id').all(entityId, status) as Record<string, unknown>[]).map(map);
}

function current(db: Db, eventId: string): EventRow {
  const ev = getEvent(db, eventId);
  if (!ev) throw new Error(`EVENT_NOT_FOUND: ${eventId}`);
  return ev;
}

/** The ONLY write the ai/ layer is permitted to call. */
export function setAiSuggestion(
  db: Db, eventId: string,
  s: { aiEventType: string; aiPurpose: string; aiCounterparty: string | null; aiConfidence: number; aiReasoning: string; nextStatus: 'AUTO' | 'NEEDS_REVIEW' },
): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, s.nextStatus);
  db.prepare(
    'UPDATE events SET ai_event_type=?, ai_purpose=?, ai_counterparty=?, ai_confidence=?, ai_reasoning=?, status=? WHERE id=?',
  ).run(s.aiEventType, s.aiPurpose, s.aiCounterparty, s.aiConfidence, s.aiReasoning, s.nextStatus, eventId);
}

export function setDecision(db: Db, eventId: string, d: { finalEventType: string; finalPurpose: string }): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, 'APPROVED');
  db.prepare('UPDATE events SET final_event_type=?, final_purpose=?, status=? WHERE id=?')
    .run(d.finalEventType, d.finalPurpose, 'APPROVED', eventId);
}

export function markPosted(db: Db, eventId: string): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, 'POSTED');
  db.prepare('UPDATE events SET status=? WHERE id=?').run('POSTED', eventId);
}
