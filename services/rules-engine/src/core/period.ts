export type PeriodId = string; // 'YYYY-Q{1..4}'

/**
 * Deterministic calendar-quarter attribution, computed in UTC.
 * UTC is the assumed cutoff timezone (spec §3.2). Single source of truth for
 * the quarter algorithm — do not re-implement quarter math anywhere else.
 */
export function periodOf(eventTime: string | Date): PeriodId {
  const d = eventTime instanceof Date ? eventTime : new Date(eventTime);
  const ms = d.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`INVALID_EVENT_TIME: cannot parse '${String(eventTime)}'`);
  }
  const year = d.getUTCFullYear();
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1; // getUTCMonth is 0-based
  return `${year}-Q${quarter}`;
}
