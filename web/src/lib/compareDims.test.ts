import { describe, it, expect } from 'vitest';
import { buildMatrix } from './compareDims';
import type { EventDTO, JournalDTO } from '../api/types';

const ev = (id: string, type: string): EventDTO => ({
  id, entityId: 'e', status: 'POSTED', normalized: {},
  ai: { eventType: type, purpose: 'p', counterparty: null, confidence: 0.9, reasoning: '' },
  final: null, routing: null,
});
const je = (eventId: string, accounts: string[]): JournalDTO => ({
  id: `je_${eventId}`, eventId, idempotencyKey: `k_${eventId}`, leafHash: 'h',
  je: { idempotencyKey: `k_${eventId}`, lineageHash: 'l', reversalOf: null,
    lines: accounts.map((a) => ({ account: a, side: 'DEBIT' as const, amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' })) },
});

describe('buildMatrix', () => {
  it('marks the eventType row as differing when two events classify differently', () => {
    const m = buildMatrix([ev('A', 'SWAP'), ev('B', 'TRANSFER')], []);
    const row = m.dimensions.find((d) => d.key === 'eventType')!;
    expect(row.differs).toBe(true);
  });
  it('marks account-set row differing when JE account sets diverge', () => {
    const m = buildMatrix([ev('A', 'SWAP'), ev('B', 'SWAP')], [je('A', ['SUI', 'USDC']), je('B', ['SUI'])]);
    expect(m.dimensions.find((d) => d.key === 'accountSet')!.differs).toBe(true);
  });
  it('caps at 4 and reports the truncated count (no silent drop)', () => {
    const events = ['A', 'B', 'C', 'D', 'E'].map((id) => ev(id, 'SWAP'));
    const m = buildMatrix(events, []);
    expect(m.shown).toHaveLength(4);
    expect(m.truncated).toBe(1);
  });
});
