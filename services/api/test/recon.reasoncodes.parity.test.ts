import { describe, it, expect } from 'vitest';
import { RECON_REASON_CODES as backendCodes } from '../src/reconciliation/types.js';
import { RECON_REASON_CODES as frontendCodes } from '../../../web/src/lib/reconBreak.js';

describe('RECON_REASON_CODES parity', () => {
  it('backend and frontend reason code arrays are identical (same order, same values)', () => {
    // Both sides must agree exactly — drift here = silent API contract break.
    expect([...backendCodes]).toEqual([...frontendCodes]);
  });
});
