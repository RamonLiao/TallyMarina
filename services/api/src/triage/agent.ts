// Exception-triage agent. Judgment (which disposition to draft) is the LLM's;
// routing, validation and every accounting gate is deterministic code (Rule 5).
// The agent ONLY proposes — applyDisposition is reachable exclusively through
// the human accept route.
import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import type { GeminiClient, GeminiSchema } from '../ai/geminiClient.js';
import { collectExceptions } from '../exceptions/collect.js';
import { getDisposition } from '../store/dispositionStore.js';
import { getEvent } from '../store/eventStore.js';
import { getPeriodLock } from '../periodLock/store.js';
import { hasAnchoredSnapshot } from '../store/snapshotStore.js';
import { REASON_CODES, type Exception, type ReasonCode } from '../exceptions/types.js';
import { DEMO_COA_RULES } from '../http/policyConstants.js';
import {
  getOpenProposal, hasRejectedProposal, insertProposal, type ProposalAction,
} from '../store/proposalStore.js';

export interface TriageRunSummary {
  scanned: number; proposed: number; skipped: number; failed: number;
  roundSkipped: 'PERIOD_LOCKED' | 'ANCHORED' | null;
}

export interface ValidatedProposal {
  action: ProposalAction; reasonCode: ReasonCode; reasonNote: string | null;
  rationale: string; confidence: number;
}

const ACTIONS: ReadonlySet<string> = new Set(['resolved', 'deferred', 'dismissed']);

const TRIAGE_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['resolved', 'deferred', 'dismissed'] },
    reasonCode: { type: 'STRING', enum: [...REASON_CODES] },
    reasonNote: { type: 'STRING', nullable: true },
    rationale: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['action', 'reasonCode', 'rationale', 'confidence'],
};

// Strict decimal literal: optional leading '-', digits, optional '.digits'. Rejects '', whitespace,
// '0x10', '1e999' and any other Number()-coercible-but-not-affirmatively-numeric string.
const STRICT_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Deterministic fail-closed gate. Anything not affirmatively valid is discarded. */
export function validateProposal(
  ex: Exception, raw: unknown, materialityThreshold: number,
): { ok: true; value: ValidatedProposal } | { ok: false; reason: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.action !== 'string' || !ACTIONS.has(r.action)) return { ok: false, reason: 'BAD_ACTION' };
  const action = r.action as ProposalAction;
  if (typeof r.reasonCode !== 'string' || !REASON_CODES.includes(r.reasonCode as ReasonCode)) return { ok: false, reason: 'BAD_REASON_CODE' };
  const reasonCode = r.reasonCode as ReasonCode;
  const reasonNote = typeof r.reasonNote === 'string' && r.reasonNote.trim().length > 0 ? r.reasonNote : null;
  if (reasonCode === 'OTHER' && !reasonNote) return { ok: false, reason: 'OTHER_REQUIRES_NOTE' };
  if (reasonNote !== null && reasonNote.length > 500) return { ok: false, reason: 'NOTE_TOO_LONG' };
  if (typeof r.rationale !== 'string' || r.rationale.trim().length === 0 || r.rationale.length > 2000) return { ok: false, reason: 'BAD_RATIONALE' };
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) return { ok: false, reason: 'BAD_CONFIDENCE' };
  // CPA F6: dismissing a blocking RULES_FAILED = transaction never posts, close unblocks. Human-only.
  if (ex.category === 'RULES_FAILED' && action === 'dismissed') return { ok: false, reason: 'BLOCKING_DISMISS_FORBIDDEN' };
  // CPA F5: materiality is a code decision, never the model's. Unknown/non-numeric amount = fail closed.
  // Amount must be an affirmatively-numeric string (strict pattern) before Number() — blocks
  // Number('')===0 and Number(' ')===0 fail-open bypasses, and exotic forms ('0x10', '1e999').
  // Compare on abs() so a negative material amount (e.g. a refund/adjustment) can't dodge the gate.
  if (action === 'dismissed' || reasonCode === 'IMMATERIAL_WAIVED') {
    const trimmed = typeof ex.amount === 'string' ? ex.amount.trim() : '';
    const amt = ex.amount !== null && STRICT_DECIMAL.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isFinite(amt) || Math.abs(amt) > materialityThreshold) return { ok: false, reason: 'MATERIALITY_GATE' };
  }
  return { ok: true, value: { action, reasonCode, reasonNote, rationale: r.rationale, confidence: r.confidence } };
}

function buildTriagePrompt(ex: Exception, rawJson: string): string {
  return [
    'You are an accounting close assistant. Draft ONE disposition proposal for this exception.',
    'A human controller reviews and accepts or rejects it — you decide nothing.',
    'Respond with valid JSON only: {action, reasonCode, reasonNote, rationale, confidence}.',
    'Actions: resolved (issue addressed), deferred (needs follow-up next period), dismissed (not an issue).',
    `Reason codes: ${REASON_CODES.join(', ')} (OTHER requires reasonNote).`,
    'Constraints you must respect: never dismiss a RULES_FAILED exception; prefer deferred+PENDING_DOC when documentation is missing.',
    'rationale: plain-language justification a controller will read (max 2000 chars). confidence: 0.0-1.0.',
    '',
    `Exception: ${JSON.stringify({ exceptionId: ex.exceptionId, category: ex.category, reason: ex.reason, amount: ex.amount, ai: ex.ai })}`,
    `Event: ${rawJson}`,
    `Chart-of-accounts mappings (context): ${JSON.stringify(DEMO_COA_RULES).slice(0, 4000)}`,
  ].join('\n');
}

function isOpen(d: { state: string } | null): boolean {
  return d === null || d.state === 'open';
}

export async function runTriageOnce(
  deps: { db: Db; cfg: ApiConfig; client: GeminiClient },
  entityId: string, periodId: string,
): Promise<TriageRunSummary> {
  const { db, cfg, client } = deps;
  const none = { scanned: 0, proposed: 0, skipped: 0, failed: 0 };
  // Locked projection turns every event into RULES_FAILED:PERIOD_CLOSED noise (CPA F8c);
  // anchored entity is read-only, proposing would burn LLM calls on unacceptable drafts (I2).
  if (getPeriodLock(db, entityId, periodId).status === 'LOCKED') return { ...none, roundSkipped: 'PERIOD_LOCKED' };
  if (hasAnchoredSnapshot(db, entityId)) return { ...none, roundSkipped: 'ANCHORED' };

  const summary: TriageRunSummary = { ...none, roundSkipped: null };
  for (const ex of collectExceptions(db, entityId, periodId, cfg.exceptionLowConfidence)) {
    summary.scanned++;
    // collectExceptions returns ALL current exceptions (I1) — open-filter here.
    if (!isOpen(getDisposition(db, ex.category, ex.eventId))) { summary.skipped++; continue; }
    if (getOpenProposal(db, ex.exceptionId)) { summary.skipped++; continue; }
    if (hasRejectedProposal(db, ex.exceptionId)) { summary.skipped++; continue; } // cooldown (F9)
    try {
      const ev = getEvent(db, ex.eventId);
      const raw = await client.generateJson<unknown>(cfg.aiModelCopilot, buildTriagePrompt(ex, ev?.rawJson ?? '{}'), TRIAGE_SCHEMA);
      const v = validateProposal(ex, raw, cfg.triageMaterialityThreshold);
      if (!v.ok) { summary.failed++; console.warn(`triage: discarded proposal for ${ex.exceptionId}: ${v.reason}`); continue; }
      // F1b TOCTOU: the lock/anchored gate above was checked once at round start, but this
      // exception just awaited an LLM round-trip — a lock (+stale-sweep) landing mid-round
      // would otherwise let this insert dodge the sweep entirely. Re-check immediately
      // before the write, not just at round start.
      if (getPeriodLock(db, entityId, periodId).status === 'LOCKED' || hasAnchoredSnapshot(db, entityId)) {
        summary.skipped++;
        continue;
      }
      insertProposal(db, {
        exceptionId: ex.exceptionId, eventId: ex.eventId, entityId, periodId,
        action: v.value.action, reasonCode: v.value.reasonCode, reasonNote: v.value.reasonNote,
        rationale: v.value.rationale, confidence: v.value.confidence,
        model: cfg.aiModelCopilot, createdAt: Date.now(),
      });
      summary.proposed++;
    } catch (err) {
      summary.failed++;
      console.warn(`triage: LLM/store failure for ${ex.exceptionId}: ${(err as Error).message}`);
    }
  }
  return summary;
}
