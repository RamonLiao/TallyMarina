import type { PositionLot } from '../domain/types.js';
import { addMinor, subMinor, mulDivFloor, ltMinor } from './decimal.js';

export interface ConsumedLot { lotId: string; qtyMinor: string; costMinor: string; }
export type FifoResult =
  | { ok: true; consumed: ConsumedLot[]; totalCarryingMinor: string }
  | { ok: false; insufficient: true; availableQtyMinor: string };

export function allocateFifo(lots: PositionLot[], coinType: string, wallet: string, qtyNeededMinor: string): FifoResult {
  // 過濾後依 seq 升冪；fail-closed：seq 不得重複（重複代表上游排序契約被破壞）。
  const pool = lots.filter((l) => l.coinType === coinType && l.wallet === wallet && l.remainingQtyMinor !== '0').slice().sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < pool.length; i++) {
    if (pool[i]!.seq === pool[i - 1]!.seq) throw new Error(`allocateFifo: duplicate lot seq ${pool[i]!.seq}`);
  }
  for (const lot of pool) {
    if (lot.remainingQtyMinor.startsWith('-') || lot.costMinor.startsWith('-'))
      throw new Error(`allocateFifo: negative lot qty/cost ${lot.lotId}`);
  }
  const available = pool.reduce((acc, l) => addMinor(acc, l.remainingQtyMinor), '0');
  if (ltMinor(available, qtyNeededMinor)) return { ok: false, insufficient: true, availableQtyMinor: available };

  const consumed: ConsumedLot[] = [];
  let remaining = qtyNeededMinor;
  let totalCarrying = '0';
  for (const lot of pool) {
    if (remaining === '0') break;
    const takeQty = ltMinor(lot.remainingQtyMinor, remaining) ? lot.remainingQtyMinor : remaining;
    // 全消耗該 lot → 取整 cost；部分 → 按比例 floor
    const takeCost = takeQty === lot.remainingQtyMinor
      ? lot.costMinor
      : mulDivFloor(lot.costMinor, takeQty, lot.remainingQtyMinor);
    consumed.push({ lotId: lot.lotId, qtyMinor: takeQty, costMinor: takeCost });
    totalCarrying = addMinor(totalCarrying, takeCost);
    remaining = subMinor(remaining, takeQty);
  }
  return { ok: true, consumed, totalCarryingMinor: totalCarrying };
}
