import { describe, it, expect } from 'vitest';
import { amountBand, buildRecallQuery, renderMemoryRecord, renderFewShotBlock } from '../src/triage/memory/format.js';

describe('amountBand', () => {
  it('null / non-numeric → UNKNOWN', () => {
    expect(amountBand(null)).toBe('UNKNOWN');
    expect(amountBand('')).toBe('UNKNOWN');
    expect(amountBand('  ')).toBe('UNKNOWN');
    expect(amountBand('0x10')).toBe('UNKNOWN');
    expect(amountBand('1e9')).toBe('UNKNOWN'); // not a strict decimal literal
  });
  it('buckets by order of magnitude, keeps sign', () => {
    expect(amountBand('0')).toBe('0');
    expect(amountBand('5')).toBe('1e0');
    expect(amountBand('42')).toBe('1e1');
    expect(amountBand('1500.50')).toBe('1e3');
    expect(amountBand('-2000')).toBe('-1e3');
    expect(amountBand('0.4')).toBe('0'); // |x|<1 collapses to 0 band
  });
});

describe('buildRecallQuery', () => {
  it('composes eventType/category/band', () => {
    expect(buildRecallQuery({ eventType: 'RECEIPT', category: 'AMOUNT_MISMATCH', amountBand: '1e3' }))
      .toBe('RECEIPT AMOUNT_MISMATCH amount≈1e3');
  });
  it('null eventType → UNKNOWN', () => {
    expect(buildRecallQuery({ eventType: null, category: 'RULES_FAILED', amountBand: 'UNKNOWN' }))
      .toBe('UNKNOWN RULES_FAILED amount≈UNKNOWN');
  });
});

describe('renderMemoryRecord', () => {
  it('renders accepted without note', () => {
    expect(renderMemoryRecord({
      entityId: 'e', eventType: 'RECEIPT', category: 'AMOUNT_MISMATCH', amountBand: '1e3',
      outcome: 'ACCEPTED', action: 'resolved', reasonCode: 'TIMING', note: null,
    })).toBe('[ACCEPTED] RECEIPT / AMOUNT_MISMATCH / amount≈1e3 → action=resolved reasonCode=TIMING');
  });
  it('renders rejected with note', () => {
    expect(renderMemoryRecord({
      entityId: 'e', eventType: 'PAYMENT', category: 'RULES_FAILED', amountBand: 'UNKNOWN',
      outcome: 'REJECTED', action: 'dismissed', reasonCode: 'OTHER', note: 'wrong account',
    })).toBe('[REJECTED] PAYMENT / RULES_FAILED / amount≈UNKNOWN → action=dismissed reasonCode=OTHER — human note: wrong account');
  });
});

describe('renderFewShotBlock', () => {
  it('empty hits → empty string (no prompt pollution)', () => {
    expect(renderFewShotBlock([])).toBe('');
  });
  it('non-empty → delimited advisory block with alignment instruction', () => {
    const out = renderFewShotBlock([{ text: 'A' }, { text: 'B', distance: 0.2 }]);
    expect(out).toContain('PRIOR HUMAN DECISIONS');
    expect(out).toContain('advisory');
    expect(out).toContain('- A');
    expect(out).toContain('- B');
    expect(out).toContain('rationale'); // asks model to note alignment in rationale
  });
});
