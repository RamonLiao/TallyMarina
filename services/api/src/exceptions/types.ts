// services/api/src/exceptions/types.ts
export type ExceptionCategory = 'RULES_FAILED' | 'CLASSIFY_REVIEW' | 'LOW_CONFIDENCE_AUTO';
export type DispositionState = 'open' | 'resolved' | 'dismissed' | 'deferred';
export type ReasonCode =
  | 'MAPPING_ADDED' | 'RECLASSIFIED' | 'DUPLICATE_CONFIRMED'
  | 'IMMATERIAL_WAIVED' | 'PENDING_DOC' | 'CARRIED_FORWARD' | 'OTHER';

export const REASON_CODES: ReasonCode[] = [
  'MAPPING_ADDED', 'RECLASSIFIED', 'DUPLICATE_CONFIRMED',
  'IMMATERIAL_WAIVED', 'PENDING_DOC', 'CARRIED_FORWARD', 'OTHER',
];

/** Categories that hard-block the period freeze. LOW_CONFIDENCE_AUTO is advisory. */
export const BLOCKING_CATEGORIES: ExceptionCategory[] = ['RULES_FAILED', 'CLASSIFY_REVIEW'];

export function severityRank(c: ExceptionCategory): number {
  return c === 'RULES_FAILED' ? 3 : c === 'CLASSIFY_REVIEW' ? 2 : 1;
}

export interface Exception {
  exceptionId: string;       // `${category}:${eventId}`
  category: ExceptionCategory;
  eventId: string;
  severity: number;          // severityRank
  reason: string;
  amount: string | null;     // best-effort from normalized payload, for future materiality
  ai: { eventType: string | null; purpose: string | null; confidence: number | null; reasoning: string | null } | null;
}
