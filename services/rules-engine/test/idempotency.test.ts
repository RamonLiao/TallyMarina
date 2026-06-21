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

it('idempotencyKey differs when bookId differs (cross-book collision guard)', () => {
  const a = makeReceiptInput('HAPPY');
  const b: RuleInput = { ...a, event: { ...a.event, bookId: 'bk-OTHER' } };
  expect(idempotencyKey(a, null)).not.toBe(idempotencyKey(b, null));
});

it('lineageHash 把 resolved refs 納入、與 key 分離', () => {
  const h1 = lineageHash({ priceRefs: ['PX-1'], fxRefs: ['identity:USD'], consumedLots: [], approvalIds: [] });
  const h2 = lineageHash({ priceRefs: ['PX-2'], fxRefs: ['identity:USD'], consumedLots: [], approvalIds: [] });
  expect(h1).not.toBe(h2);
});

it('lineageHash: same lotId but different qtyMinor → different hash (audit granularity)', () => {
  const h1 = lineageHash({ priceRefs: [], fxRefs: [], consumedLots: [{ lotId: 'LOT-1', qtyMinor: '50', costMinor: '100' }], approvalIds: [] });
  const h2 = lineageHash({ priceRefs: [], fxRefs: [], consumedLots: [{ lotId: 'LOT-1', qtyMinor: '99', costMinor: '100' }], approvalIds: [] });
  expect(h1).not.toBe(h2);
});
