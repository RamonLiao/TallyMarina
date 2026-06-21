import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phasePriceFx } from '../../src/pipeline/phases/p06_pricefx.js';
import { phaseLot } from '../../src/pipeline/phases/p07_lot.js';
import { phaseMeasure } from '../../src/pipeline/phases/p08_measure.js';
import { phaseMapping } from '../../src/pipeline/phases/p09_mapping.js';
import type { LotMovement } from '../../src/domain/types.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

const phases = [phasePriceFx, phaseLot, phaseMeasure, phaseMapping];

describe('phase 6-9', () => {
  it('happy: FV 300, acquisition lot +100/300, accounts resolved', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), phases);
    expect(r.exception).toBeNull();
    expect(r.carry.fvFunctionalMinor).toBe('300');
    expect(r.carry.lotMovements).toEqual([
      expect.objectContaining({ deltaQtyMinor: '100', deltaCostMinor: '300' }),
    ]);
  });
  it('missing price → PRICE_MISSING at phase 6 (GF-RCV-MISSING-PXFX)', () => {
    const r = runPipeline(makeReceiptInput('NO_PRICE'), phases);
    expect(r.exception).toMatchObject({ phase: 6, code: 'PRICE_MISSING' });
  });
  it('missing fx → FX_MISSING at phase 6', () => {
    const r = runPipeline(makeReceiptInput('NO_FX'), phases);
    expect(r.exception).toMatchObject({ phase: 6, code: 'FX_MISSING' });
  });
  it('receipt does NOT consume lots: INSUFFICIENT-LOT permutation produces no shortage', () => {
    // why: receipt 只建 lot 不消耗；若有人誤加 FIFO 消耗，此測試必須 fail
    const r = runPipeline(makeReceiptInput('INSUFFICIENT_LOT'), phases);
    expect(r.exception).toBeNull();
    expect((r.carry.lotMovements as LotMovement[]).every((m) => BigInt(m.deltaQtyMinor) >= 0n)).toBe(true);
  });
});
