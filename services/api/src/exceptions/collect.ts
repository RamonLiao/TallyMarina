// services/api/src/exceptions/collect.ts
import type { Db } from '../store/db.js';
import { listEvents } from '../store/eventStore.js';
import type { EventRow } from '../store/eventStore.js';
import { buildRuleInput } from '../http/buildRuleInput.js';
import { evaluate } from '../deps/rulesEngine.js';
import { getPeriodLock } from '../periodLock/store.js';
import { type Exception, type ExceptionCategory, severityRank } from './types.js';

function aiBlock(e: EventRow) {
  const has = e.aiEventType !== null || e.aiConfidence !== null;
  return has ? { eventType: e.aiEventType, purpose: e.aiPurpose, confidence: e.aiConfidence, reasoning: e.aiReasoning } : null;
}

// Best-effort amount extraction from the normalized payload — surfaced for future
// materiality sorting (spec §9.5). Never throws.
function amountOf(e: EventRow): string | null {
  try {
    const raw = JSON.parse(e.rawJson) as Record<string, unknown>;
    const v = raw.amount ?? raw.value ?? (raw as Record<string, unknown>).quantity;
    return v == null ? null : String(v);
  } catch { return null; }
}

function mk(category: ExceptionCategory, e: EventRow, reason: string): Exception {
  return {
    exceptionId: `${category}:${e.id}`,
    category, eventId: e.id, severity: severityRank(category),
    reason, amount: amountOf(e), ai: aiBlock(e),
  };
}

/**
 * Pure read-aggregator. Projects current events into typed exceptions.
 * NO writes, NO persistence — single source of truth stays in events + rules engine.
 * `evaluate()` is the same pure function run-rules uses; calling it here is side-effect free.
 */
export function collectExceptions(db: Db, entityId: string, periodId: string, lowConfidence: number): Exception[] {
  const out: Exception[] = [];
  // Probe "would this event post?" under the REAL period state so the diagnosis
  // matches what run-rules would actually do (locked → PERIOD_CLOSED is truthful).
  const periodOpen = getPeriodLock(db, entityId, periodId).status !== 'LOCKED';
  for (const e of listEvents(db, entityId)) {
    if (e.status === 'NEEDS_REVIEW') {
      out.push(mk('CLASSIFY_REVIEW', e, 'AI routed to human review (low classification confidence)'));
    }
    if (e.status === 'AUTO' && e.aiConfidence !== null && e.aiConfidence < lowConfidence) {
      out.push(mk('LOW_CONFIDENCE_AUTO', e, `auto-classified at ${e.aiConfidence.toFixed(2)}, below comfort band ${lowConfidence}`));
    }
    // RULES_FAILED: non-POSTED APPROVED/AUTO events that cannot post.
    if (e.status === 'APPROVED' || e.status === 'AUTO') {
      let reason = '';
      try {
        const o = evaluate(buildRuleInput(e, { periodId, periodOpen }));
        if (o.decision !== 'POSTABLE' || o.journalEntries.length === 0) {
          reason = o.exceptions[0]?.code ?? (o.decision === 'POSTABLE' ? 'NO_JOURNAL_ENTRIES' : o.decision);
        }
      } catch (err) {
        reason = `EVAL_THREW: ${(err as Error).message}`;
      }
      if (reason) out.push(mk('RULES_FAILED', e, reason));
    }
  }
  out.sort((a, b) => b.severity - a.severity || (a.ai?.confidence ?? 1) - (b.ai?.confidence ?? 1));
  return out;
}
