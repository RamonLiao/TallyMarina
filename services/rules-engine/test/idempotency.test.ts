import { describe, it, expect } from 'vitest';
import { idempotencyKey } from '../src/core/idempotency.js';
import type { RuleInput } from '../src/domain/types.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('idempotencyKey', () => {
  it('same input → same key; different price ref → different key', () => {
    const a = makeReceiptInput('HAPPY');
    const b = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, null)).toBe(idempotencyKey(b, null));
    const c: RuleInput = { ...a, prices: [{ ...a.prices[0]!, id: 'PX-OTHER' }] };
    expect(idempotencyKey(c, null)).not.toBe(idempotencyKey(a, null));
  });
  it('prior JE id participates (reversal lineage differs)', () => {
    const a = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, 'JE-1')).not.toBe(idempotencyKey(a, null));
  });
});
