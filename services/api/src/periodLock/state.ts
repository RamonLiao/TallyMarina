export type PeriodStatus = 'OPEN' | 'LOCKED';
export type PeriodAction = 'lock' | 'reopen';

// Restatement classification — drives disclosure treatment (ASC 250 / IAS 8).
// Stored on reopen so the audit trail records WHY a closed period was unwound.
export const REOPEN_REASON_CODES = [
  'ERROR_CORRECTION',
  'ESTIMATE_CHANGE',
  'LATE_ARRIVING_TXN',
  'RECLASSIFICATION',
  'OTHER',
] as const;
export type ReopenReasonCode = (typeof REOPEN_REASON_CODES)[number];

const LEGAL: Record<PeriodStatus, Partial<Record<PeriodAction, PeriodStatus>>> = {
  OPEN: { lock: 'LOCKED' },
  LOCKED: { reopen: 'OPEN' },
};

export function assertPeriodTransition(from: PeriodStatus, action: PeriodAction): PeriodStatus {
  const to = LEGAL[from]?.[action];
  if (!to) throw new Error(`ILLEGAL_TRANSITION: ${from} --${action}-->`);
  return to;
}
