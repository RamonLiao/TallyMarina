import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('monkey: 極端輸入不得 silent 過或 crash', () => {
  it('negative quantity rejected at schema (phase 1); 方向由 event type 表達，不以負量承載', () => {
    // why: 負量產負借貸金額、語義壞；fail-closed 在最前面擋下
    const i = makeReceiptInput('HAPPY');
    (i.event as { quantityMinor: string }).quantityMinor = '-100';
    const out = evaluate(i);
    expect(out.decision).toBe('REJECTED');
    expect(out.exceptions[0]).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
    expect(out.journalEntries).toEqual([]);
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

  it('price/qty scale mismatch (non-integer FV) → 收斂成 INPUT_ERROR，不 silent rounding、不崩潰', () => {
    // why: FV 必須整除；殘餘小數不可被 silent 截斷成假帳，且不得讓服務 throw
    const ok = makeReceiptInput('HAPPY');
    ok.event.assetDecimals = 2;            // 100 minor = 1.00 unit
    ok.prices[0]!.unitPriceMinor = '3';    // 1.00 × 3 = 3 → 整除 OK
    expect(evaluate(ok).decision).toBe('POSTABLE');

    const bad = makeReceiptInput('HAPPY');
    bad.event.assetDecimals = 2;
    bad.prices[0]!.unitPriceMinor = '3';
    bad.event.quantityMinor = '101';       // 1.01 × 3 = 3.03 → 非整除
    const out = evaluate(bad);
    expect(out.decision).toBe('REJECTED');
    expect(out.exceptions[0]!.code).toBe('INPUT_ERROR');
  });

  it('out-of-range assetDecimals rejected at schema (phase 1), no DoS', () => {
    const i = makeReceiptInput('HAPPY');
    i.event.assetDecimals = 1_000_000;     // 防 10^n BigInt 指數 DoS
    const out = evaluate(i);
    expect(out.exceptions[0]).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
  });

  it('garbage/null input → INPUT_ERROR, 不崩潰 (catch block 自身不可 re-throw)', () => {
    for (const bad of [null, undefined, {}, { event: null }, 42, 'str']) {
      const out = evaluate(bad as never);
      expect(out.decision).toBe('REJECTED');
      expect(out.exceptions[0]!.code).toBe('INPUT_ERROR');
    }
  });

  it('unregistered eventType → REVIEW_REQUIRED NOT_IMPLEMENTED_IN_SLICE (不 throw)', () => {
    const inp = makeReceiptInput('HAPPY');
    (inp.event as any).eventType = 'STAKING_REWARD'; // not in STRATEGIES
    const out = evaluate(inp);
    expect(out.decision).toBe('REVIEW_REQUIRED');
    expect(out.exceptions[0]!.code).toBe('NOT_IMPLEMENTED_IN_SLICE');
  });

  it('each non-receipt/non-payment pilot event → NOT_IMPLEMENTED_IN_SLICE phase 3', () => {
    for (const t of ['INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE'] as const) {
      const i = makeReceiptInput('HAPPY');
      (i.event as { eventType: string }).eventType = t;
      const out = evaluate(i);
      expect(out.exceptions[0]).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
      expect(out.decision).toBe('REVIEW_REQUIRED');
    }
  });
});
