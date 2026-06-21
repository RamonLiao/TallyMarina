import { describe, it, expect } from 'vitest';
import { idempotencyKey, lineageHash } from '../src/core/idempotency.js';
import type { RuleInput } from '../src/domain/types.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('idempotencyKey', () => {
  it('same input → same key', () => {
    const a = makeReceiptInput('HAPPY');
    const b = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, null)).toBe(idempotencyKey(b, null));
  });
  it('prior JE id participates (reversal lineage differs)', () => {
    const a = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, 'JE-1')).not.toBe(idempotencyKey(a, null));
  });
});

it('idempotencyKey 不受無關 price/fx/lot 影響（修 codex #4）', () => {
  const a = makeReceiptInput('HAPPY');
  const b = { ...a, prices: [...a.prices, { id: 'PX-NOISE', coinType: 'x', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '9' }] };
  expect(idempotencyKey(a, null)).toBe(idempotencyKey(b, null));
});

it('lineageHash 把 resolved refs 納入、與 key 分離', () => {
  const h1 = lineageHash({ priceRefs: ['PX-1'], fxRefs: ['identity:USD'], consumedLotIds: [], approvalIds: [] });
  const h2 = lineageHash({ priceRefs: ['PX-2'], fxRefs: ['identity:USD'], consumedLotIds: [], approvalIds: [] });
  expect(h1).not.toBe(h2);
});
