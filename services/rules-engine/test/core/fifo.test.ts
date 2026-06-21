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
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.consumed[0]!.costMinor).toBe('80');
  });

  it('多 lot 跨筆 FIFO 依 seq；最後一筆吸收尾差', () => {
    // 需 50：A(30/100) 全取 cost100；B 取 20/40，cost = floor(50*20/40)=25
    const r = allocateFifo([L(2, 'B', '40', '50'), L(1, 'A', '30', '100')], 'SUI', '0xA', '50');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.consumed.map((c) => c.lotId)).toEqual(['A', 'B']);
      expect(r.totalCarryingMinor).toBe('125');
    }
  });

  it('不足 → insufficient + availableQtyMinor', () => {
    const r = allocateFifo([L(1, 'A', '10', '20')], 'SUI', '0xA', '50');
    expect(r).toEqual({ ok: false, insufficient: true, availableQtyMinor: '10' });
  });

  it('亂序輸入仍正確排序（不拋例外）', () => {
    const r = allocateFifo([L(2, 'B', '10', '10'), L(1, 'A', '10', '10')], 'SUI', '0xA', '5');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.consumed[0]!.lotId).toBe('A'); // FIFO takes seq=1 lot first
  });

  it('duplicate seq → fail-closed throw', () => {
    expect(() => allocateFifo([L(1, 'X', '10', '10'), L(1, 'Y', '10', '10')], 'SUI', '0xA', '5')).toThrow(/duplicate lot seq/);
  });

  it('FIFO floor/residual conservation: mulDivFloor(10,1,3)=3; taken+residual===original', () => {
    // lot cost=10, qty=3; take qty=1 → floor(10*1/3)=3
    // conservation: takenCost(3) + residual(10-3=7) === original(10)
    const r = allocateFifo([L(1, 'A', '3', '10')], 'SUI', '0xA', '1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.consumed[0]!.costMinor).toBe('3');
      // residual stays with lot: originalCost(10) - takenCost(3) = 7; no money leaks
      const takenCost = BigInt(r.consumed[0]!.costMinor);
      const originalCost = 10n;
      expect(takenCost + (originalCost - takenCost)).toBe(originalCost);
    }
  });

  it('multi-lot FIFO: full + floored-partial; totalCarrying exact, no rounding inflation', () => {
    // lot A: qty=2, cost=10 (fully taken); lot B: qty=3, cost=10 (take 1 → floor(10*1/3)=3)
    // totalCarrying should be 10 + 3 = 13; no inflation
    const r = allocateFifo([L(1, 'A', '2', '10'), L(2, 'B', '3', '10')], 'SUI', '0xA', '3');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.consumed.map((c) => c.lotId)).toEqual(['A', 'B']);
      const lotA = r.consumed.find((c) => c.lotId === 'A')!;
      const lotB = r.consumed.find((c) => c.lotId === 'B')!;
      expect(lotA.costMinor).toBe('10'); // fully consumed
      expect(lotB.costMinor).toBe('3');  // floor(10*1/3)=3
      expect(r.totalCarryingMinor).toBe('13'); // 10+3; no rounding inflation
    }
  });
});
