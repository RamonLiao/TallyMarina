import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phaseClassification } from '../../src/pipeline/phases/p03_classification.js';
import { phaseAssetScope } from '../../src/pipeline/phases/p04_assetScope.js';
import { phaseRecognition } from '../../src/pipeline/phases/p05_recognition.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

const phases = [phaseClassification, phaseAssetScope, phaseRecognition];

describe('phase 3-5', () => {
  it('receipt happy passes, carries assessment + recognize', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), phases);
    expect(r.exception).toBeNull();
    expect(r.carry.recognize).toBe(true);
  });
  it('unregistered event → NOT_IMPLEMENTED_IN_SLICE at phase 3 (non-silent)', () => {
    // why: §12 fail loud — 未實作的 event 不可 silent 通過; 5 個 pilot event 皆已註冊(Task 8)，用非 pilot 型別驗 guard
    const ev = makeReceiptInput('HAPPY');
    (ev.event as { eventType: string }).eventType = 'STAKING_REWARD';
    const r = runPipeline(ev, phases);
    expect(r.exception).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
  });
  it('unapproved asset classification → SCOPE_UNKNOWN at phase 4 (GF-RCV-SCOPE)', () => {
    const r = runPipeline(makeReceiptInput('SCOPE'), phases);
    expect(r.exception).toMatchObject({ phase: 4, code: 'SCOPE_UNKNOWN' });
  });
});
