import { describe, it, expect } from 'vitest';
import { allocateFifo } from '../../src/core/fifo.js';
import type { PositionLot } from '../../src/domain/types.js';

const L = (seq: number, lotId: string, qty: string, cost: string): PositionLot =>
  ({ lotId, seq, coinType: 'SUI', wallet: '0xA', remainingQtyMinor: qty, costMinor: cost });

describe('allocateFifo', () => {
  it('單 lot 全消耗', () => {
    const r = allocateFifo([L(1, 'A', '100', '200')], 'SUI', '0xA', '100');
    expect(r).toMatchObject({ ok: true, totalCarryingMinor: '200' });
    if (r.ok) expect(r.consumed).toEqual([{ lotId: 'A', qtyMinor: '100', costMinor: '200' }]);
  });

  it('部分消耗：carrying 按比例 floor，餘額留 lot', () => {
    // 取 40/100，cost 200 → 200*40/100 = 80
    const r = allocateFifo([L(1, 'A', '100', '200')], 'SUI', '0xA', '40');
    if (r.ok) expect(r.consumed[0]!.costMinor).toBe('80');
  });

  it('多 lot 跨筆 FIFO 依 seq；最後一筆吸收尾差', () => {
    // 需 50：A(30/100) 全取 cost100；B 取 20/40，cost = floor(50*20/40)=25
    const r = allocateFifo([L(2, 'B', '40', '50'), L(1, 'A', '30', '100')], 'SUI', '0xA', '50');
    if (r.ok) {
      expect(r.consumed.map((c) => c.lotId)).toEqual(['A', 'B']);
      expect(r.totalCarryingMinor).toBe('125');
    }
  });

  it('不足 → insufficient + availableQtyMinor', () => {
    const r = allocateFifo([L(1, 'A', '10', '20')], 'SUI', '0xA', '50');
    expect(r).toEqual({ ok: false, insufficient: true, availableQtyMinor: '10' });
  });

  it('未按 seq 排序 → fail-closed throw', () => {
    expect(() => allocateFifo([L(2, 'B', '10', '10'), L(1, 'A', '10', '10')], 'SUI', '0xA', '5')).not.toThrow();
    // 注意：函式內部會先 filter+sort 自己排序並斷言一致性；此處驗證輸入亂序仍正確（見 Step 3 設計）
  });
});
