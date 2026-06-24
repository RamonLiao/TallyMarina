import { describe, it, expect } from 'vitest';
import { assertPeriodTransition, REOPEN_REASON_CODES } from '../../src/periodLock/state.js';

describe('period state machine', () => {
  it('OPEN --lock--> LOCKED', () => {
    expect(assertPeriodTransition('OPEN', 'lock')).toBe('LOCKED');
  });
  it('LOCKED --reopen--> OPEN', () => {
    expect(assertPeriodTransition('LOCKED', 'reopen')).toBe('OPEN');
  });
  // WHY: a closed period must not be re-lockable without a reopen first; an open
  // period must not be reopen-able. Both are accounting-control violations.
  it('rejects lock when already LOCKED', () => {
    expect(() => assertPeriodTransition('LOCKED', 'lock')).toThrow(/ILLEGAL_TRANSITION/);
  });
  it('rejects reopen when OPEN', () => {
    expect(() => assertPeriodTransition('OPEN', 'reopen')).toThrow(/ILLEGAL_TRANSITION/);
  });
  it('exposes a non-empty reason-code enum', () => {
    expect(REOPEN_REASON_CODES.length).toBeGreaterThan(0);
    expect(REOPEN_REASON_CODES).toContain('ERROR_CORRECTION');
  });
});
