import { describe, it, expect } from 'vitest';
import { validateMeta } from '../src/core/validate.js';
import { SnapshotError } from '../src/domain/types.js';

const ok = { entityId: 'entity-1', periodId: '2026-Q2', createdAtLogical: 1 };

function code(fn: () => void): string {
  try { fn(); return 'NO_THROW'; }
  catch (e) { return e instanceof SnapshotError ? e.code : 'WRONG_ERROR'; }
}

describe('validateMeta fail-closed', () => {
  it('passes valid meta', () => expect(code(() => validateMeta(ok))).toBe('NO_THROW'));
  it('empty entityId → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, entityId: '' }))).toBe('INVALID_META'));
  it('non-integer createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: 1.5 }))).toBe('INVALID_META'));
  it('negative createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: -1 }))).toBe('INVALID_META'));
  it('NaN createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: NaN }))).toBe('INVALID_META'));
  it('periodId > 64 bytes → PERIOD_ID_TOO_LONG', () =>
    expect(code(() => validateMeta({ ...ok, periodId: 'x'.repeat(65) }))).toBe('PERIOD_ID_TOO_LONG'));
  it('multibyte periodId counted by bytes not chars', () => {
    // '€' = 3 bytes; 22 chars = 66 bytes > 64
    expect(code(() => validateMeta({ ...ok, periodId: '€'.repeat(22) }))).toBe('PERIOD_ID_TOO_LONG');
  });
  it('lone surrogate entityId → INVALID_ENCODING', () =>
    expect(code(() => validateMeta({ ...ok, entityId: '\uD800' }))).toBe('INVALID_ENCODING'));
});
