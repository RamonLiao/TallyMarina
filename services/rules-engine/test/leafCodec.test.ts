import { describe, it, expect } from 'vitest';
import { encodeJeLeaf, JE_LEAF_CODEC_VERSION } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    idempotencyKey: 'a'.repeat(64),
    lineageHash: 'b'.repeat(64),
    reversalOf: null,
    lines: [
      {
        account: '1000', side: 'DEBIT', amountMinor: '100',
        origCoinType: '0x2::sui::SUI', origQtyMinor: '5', priceRef: 'p1', fxRef: null, leg: 'MAIN',
      },
      {
        account: '4000', side: 'CREDIT', amountMinor: '100',
        origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN',
      },
    ],
    ...overrides,
  };
}

describe('leafCodec (JE_LEAF_BCS_V1)', () => {
  it('version id is frozen', () => {
    expect(JE_LEAF_CODEC_VERSION).toBe('JE_LEAF_BCS_V1');
  });

  it('encodes deterministically (same JE -> identical bytes)', () => {
    // why: leaf preimage 必須位元級穩定，否則 merkle root 漂移、auditor 對不上
    const a = encodeJeLeaf(je());
    const b = encodeJeLeaf(je());
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  it('excludes lineageHash from the preimage', () => {
    // why: lineageHash 是 off-chain sidecar，進 leaf 會讓 root 受審計旁資料污染
    const base = encodeJeLeaf(je({ lineageHash: 'b'.repeat(64) }));
    const diff = encodeJeLeaf(je({ lineageHash: 'c'.repeat(64) }));
    expect(Buffer.from(base).toString('hex')).toBe(Buffer.from(diff).toString('hex'));
  });

  it('is sensitive to line field changes', () => {
    // why: 任一借貸欄位變動都必須改變 leaf，否則竄改不可偵測
    const base = encodeJeLeaf(je());
    const tampered = encodeJeLeaf(je({
      lines: [{ ...je().lines[0], amountMinor: '101' }, je().lines[1]],
    }));
    expect(Buffer.from(base).toString('hex')).not.toBe(Buffer.from(tampered).toString('hex'));
  });

  it('encodes side DEBIT=0 / CREDIT=1 distinctly', () => {
    // why: 借貸方向是會計語義核心，必須在 preimage 中可區分
    const d = encodeJeLeaf(je({ lines: [{ ...je().lines[0], side: 'DEBIT' }] }));
    const c = encodeJeLeaf(je({ lines: [{ ...je().lines[0], side: 'CREDIT' }] }));
    expect(Buffer.from(d).toString('hex')).not.toBe(Buffer.from(c).toString('hex'));
  });
});
