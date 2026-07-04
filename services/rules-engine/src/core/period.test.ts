import { describe, it, expect } from 'vitest';
import { periodOf } from './period';

describe('periodOf', () => {
  it('maps months to calendar quarters (UTC)', () => {
    expect(periodOf('2026-01-15T12:00:00Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00Z')).toBe('2026-Q2');
    expect(periodOf('2026-07-31T23:59:59Z')).toBe('2026-Q3');
    expect(periodOf('2026-12-31T00:00:00Z')).toBe('2026-Q4');
  });

  it('pins quarter boundaries at UTC midnight', () => {
    expect(periodOf('2026-03-31T23:59:59.999Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00.000Z')).toBe('2026-Q2');
  });

  it('uses UTC, not local time, on a boundary instant', () => {
    // 2026-04-01T00:30:00Z is still Q2 in UTC regardless of host TZ.
    expect(periodOf('2026-04-01T00:30:00Z')).toBe('2026-Q2');
    // An instant that is Mar-31 in UTC but Apr-1 in +14:00 must bin by UTC → Q1.
    expect(periodOf('2026-03-31T22:00:00Z')).toBe('2026-Q1');
  });

  it('handles year rollover', () => {
    expect(periodOf('2027-01-01T00:00:00Z')).toBe('2027-Q1');
    expect(periodOf('2025-12-31T23:59:59Z')).toBe('2025-Q4');
  });

  it('rejects unparseable eventTime with INVALID_EVENT_TIME', () => {
    expect(() => periodOf('not-a-date')).toThrow(/^INVALID_EVENT_TIME/);
    expect(() => periodOf('')).toThrow(/^INVALID_EVENT_TIME/);
  });
});
