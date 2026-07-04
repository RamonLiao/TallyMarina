import type { Db } from '../../store/db.js';
import type { MemoryClient, MemoryHit, MemoryRecord, RecallFeatures, RecallOutcome } from './types.js';
import { renderMemoryRecord } from './format.js';

interface DecidedRow {
  exception_id: string; action: string; reason_code: string; decision_note: string | null;
  status: string; event_type: string | null;
}

/**
 * Feature-approximation recall from the local audit log — intentionally weaker than semantic
 * (stability > precision, per spec §8). Entity-scoped; category-matched (parsed from exceptionId).
 * remember() is a no-op: the authoritative data already lives in triage_proposal.
 */
export class LocalMemory implements MemoryClient {
  constructor(private readonly db: Db, private readonly defaultLimit: number) {}

  async recall(input: { entityId: string; features: RecallFeatures; limit: number }): Promise<RecallOutcome> {
    try {
      const rows = this.db.prepare(
        `SELECT tp.exception_id, tp.action, tp.reason_code, tp.decision_note, tp.status, e.ai_event_type AS event_type
         FROM triage_proposal tp
         LEFT JOIN events e ON e.id = tp.event_id
         WHERE tp.entity_id = ? AND tp.status IN ('accepted','rejected')
         ORDER BY tp.decided_at DESC
         LIMIT ?`,
      ).all(input.entityId, Math.max(input.limit, this.defaultLimit) * 4) as DecidedRow[];
      const hits: MemoryHit[] = [];
      for (const r of rows) {
        const category = r.exception_id.split(':')[0] ?? '';
        if (category !== input.features.category) continue; // category-match filter
        const rec: MemoryRecord = {
          entityId: input.entityId, eventType: r.event_type, category,
          amountBand: 'UNKNOWN', // local table has no amount; approximation
          outcome: r.status === 'accepted' ? 'ACCEPTED' : 'REJECTED',
          action: r.action, reasonCode: r.reason_code, note: r.decision_note,
        };
        hits.push({ text: renderMemoryRecord(rec) });
        if (hits.length >= input.limit) break;
      }
      return { hits, servedBy: 'local' };
    } catch {
      return { hits: [], servedBy: 'local' }; // fail-open: recall must never throw
    }
  }

  async remember(): Promise<void> { /* noop — data already in triage_proposal */ }
  async probe(): Promise<void> { /* noop */ }
  async close(): Promise<void> { /* noop */ }
}
