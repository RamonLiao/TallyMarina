import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';
import { makePaymentInput } from './fixtures/payment.js';
import { makeSwapInput } from './fixtures/swap.js';

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

  it('unimplemented (non-pilot) event → NOT_IMPLEMENTED_IN_SLICE phase 3', () => {
    // 5 個 pilot event 皆已註冊(Task 8)；用非 pilot 型別驗 fail-closed guard 仍擋未實作事件
    for (const t of ['STAKING_REWARD', 'CEX_DEPOSIT'] as const) {
      const i = makeReceiptInput('HAPPY');
      (i.event as { eventType: string }).eventType = t;
      const out = evaluate(i);
      expect(out.exceptions[0]).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
      expect(out.decision).toBe('REVIEW_REQUIRED');
    }
  });

  it('SPOT_TRADE_SWAP without consideration fields → NOT_IMPLEMENTED_IN_SLICE phase 5', () => {
    // swap is registered but missing considerationAsset → classify() rejects at phase 5
    const i = makeReceiptInput('HAPPY');
    (i.event as { eventType: string }).eventType = 'SPOT_TRADE_SWAP';
    const out = evaluate(i);
    expect(out.exceptions[0]).toMatchObject({ phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE' });
    expect(out.decision).toBe('REVIEW_REQUIRED');
  });
});

describe('monkey: cross-event 邊界', () => {
  it('carrying > FV → 走 disposal_loss（DEBIT gain account）', () => {
    // why: carrying 200 > FV 20*4=80 → loss 120；DEBIT LOSS account（gain side DEBIT 表示損失）
    const inp = makePaymentInput('HAPPY');
    inp.lots = [{ lotId: 'L', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '20', costMinor: '200' }];
    const je = evaluate(inp).journalEntries[0]!;
    const lossLine = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS');
    expect(lossLine).toMatchObject({ side: 'DEBIT', amountMinor: '120' });
  });

  it('replay 後不重複消耗 lot（lotMovements 空）', () => {
    // why: idempotency — replaying same event must not create new lot movements
    const base = makePaymentInput('HAPPY');
    const prior = evaluate(base).journalEntries[0]!;
    const r = evaluate({ ...base, runContext: { ...base.runContext, mode: 'REPLAY' as const }, priorJournalEntries: { [prior.idempotencyKey]: prior } });
    expect(r.lotMovements).toEqual([]);
  });

  it('uniform JE-line shape：所有 event 的 line 都有相同 key 集（canonical-complete）', () => {
    // why: N3 canonical-complete leaf shape — every JeLine must have identical Object.keys
    // regardless of event type; missing fields (vs explicit null) break merkle proof portability
    const keys = (je: { lines: object[] }) => je.lines.map((l) => Object.keys(l).sort().join(','));
    const pay = evaluate(makePaymentInput('HAPPY')).journalEntries[0]!;
    const swp = evaluate(makeSwapInput('HAPPY')).journalEntries[0]!;
    const allShapes = [...keys(pay), ...keys(swp)];
    expect(new Set(allShapes).size).toBe(1);
  });
});
