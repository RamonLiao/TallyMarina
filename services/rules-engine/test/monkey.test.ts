import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('monkey: 極端輸入不得 silent 過或 crash', () => {
  it('negative quantity: receipt 仍輸出可審 JE (fail-loud 交下游 review)', () => {
    const i = makeReceiptInput('HAPPY');
    (i.event as { quantityMinor: string }).quantityMinor = '-100';
    const out = evaluate(i);
    expect(out.decision).toBe('POSTABLE');
    expect(out.journalEntries[0]!.lines[0]!.amountMinor).toBe('-300');
  });

  it('huge decimal does not overflow (bigint)', () => {
    const i = makeReceiptInput('HAPPY');
    const big = '9'.repeat(40);
    (i.event as { quantityMinor: string }).quantityMinor = big;
    i.prices[0]!.unitPriceMinor = '1';
    const out = evaluate(i);
    expect(out.journalEntries[0]!.lines[0]!.amountMinor).toBe(big);
  });

  it('missing schemaVersion → SCHEMA_INVALID phase 1 (fail loud)', () => {
    const i = makeReceiptInput('HAPPY');
    (i.event as { schemaVersion: string }).schemaVersion = '';
    const out = evaluate(i);
    expect(out.exceptions[0]).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
  });

  it('period closed → PERIOD_CLOSED, no JE', () => {
    const i = makeReceiptInput('HAPPY');
    i.policySet.periodOpen = false;
    const out = evaluate(i);
    expect(out.exceptions[0]!.code).toBe('PERIOD_CLOSED');
    expect(out.journalEntries).toEqual([]);
  });

  it('price/qty scale mismatch (non-integer FV) throws, not silent rounding', () => {
    // why: FV 必須整除；殘餘小數不可被 silent 截斷成假帳
    const i = makeReceiptInput('HAPPY');
    i.event.assetDecimals = 2;            // 100 minor = 1.00 unit
    i.prices[0]!.unitPriceMinor = '3';    // 1.00 × 3 = 3 → 整除 OK
    expect(() => evaluate(i)).not.toThrow();
    i.event.quantityMinor = '101';        // 1.01 × 3 = 3.03 → 非整除
    expect(() => evaluate(i)).toThrow(/non-integer FV/);
  });

  it('each non-receipt pilot event → NOT_IMPLEMENTED_IN_SLICE phase 3', () => {
    for (const t of ['DIGITAL_ASSET_PAYMENT', 'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE'] as const) {
      const i = makeReceiptInput('HAPPY');
      (i.event as { eventType: string }).eventType = t;
      const out = evaluate(i);
      expect(out.exceptions[0]).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
      expect(out.decision).toBe('REVIEW_REQUIRED');
    }
  });
});
