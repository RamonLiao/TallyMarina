import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveMode } from '../lib/auditSelection';
import { sumFunctional } from '../lib/balance';
import { buildMatrix } from '../lib/compareDims';
import { recomputeRoot, resolveProofState } from '../lib/proofVerify';
import { EventLineage } from '../components/data/EventLineage';
import type { EventDTO, JournalDTO, InclusionProof } from '../api/types';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const ev = (over: Partial<EventDTO> = {}): EventDTO => ({
  id: 'E', entityId: 'e', status: 'POSTED', normalized: {}, ai: null, final: null, routing: null, ...over,
});

describe('monkey: selection', () => {
  it('rapid deselect from compare(2) to one leaves lineage, not crash', () => {
    expect(deriveMode({ selectedId: null, compareIds: ['a', 'b'] })).toBe('compare');
    expect(deriveMode({ selectedId: null, compareIds: ['a'] })).toBe('lineage');
    expect(deriveMode({ selectedId: null, compareIds: [] })).toBe('pick');
  });
});

describe('monkey: balance', () => {
  it('empty lines → balanced Δ0 (no NaN, no throw)', () => {
    const r = sumFunctional([]);
    expect(r.delta).toBe(0n);
  });
  it('throws on non-numeric amountMinor (fail-loud, never silent NaN)', () => {
    expect(() => sumFunctional([{ account: 'a', side: 'DEBIT', amountMinor: 'oops', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' }])).toThrow();
  });
  it('handles 50 lines of huge minor units without precision loss', () => {
    const big = '12345678901234567890';
    const lines = Array.from({ length: 50 }, (_, i) => ({ account: 'a', side: (i % 2 ? 'CREDIT' : 'DEBIT') as 'DEBIT' | 'CREDIT', amountMinor: big, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' }));
    expect(sumFunctional(lines).balanced).toBe(true);
  });
});

describe('monkey: compare matrix', () => {
  it('1 event (degenerate) → no dimension marked differing', () => {
    const m = buildMatrix([ev({ id: 'A', ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.9, reasoning: '' } })], []);
    expect(m.dimensions.every((d) => !d.differs)).toBe(true);
  });
  it('20 selected → caps at 4, truncated 16', () => {
    const events = Array.from({ length: 20 }, (_, i) => ev({ id: `E${i}` }));
    const m = buildMatrix(events, []);
    expect(m.shown).toHaveLength(4);
    expect(m.truncated).toBe(16);
  });
});

describe('monkey: proof verify', () => {
  it('tampered sibling → mismatch, never silently verified', async () => {
    const enc = new TextEncoder();
    const sha = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const h2b = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
    const leaf = await sha(Uint8Array.of(0x00, ...enc.encode('A')) as Uint8Array<ArrayBuffer>);
    const sib = await sha(Uint8Array.of(0x00, ...enc.encode('B')) as Uint8Array<ArrayBuffer>);
    const root = await recomputeRoot(leaf, [{ hash: sib, position: 'R' }]);
    const tampered: InclusionProof = { idempotencyKey: 'k', leafIndex: 0, siblings: [{ hash: 'ff'.repeat(32), position: 'R' }], merkleRoot: root };
    const s = await resolveProofState({ leafHash: leaf, proof: tampered, anchors: [] });
    expect(s.kind).toBe('mismatch');
    void h2b;
  });
});

describe('monkey: lineage rendering', () => {
  it('reversalOf pointing at a missing JE still renders (no crash)', () => {
    const je: JournalDTO = { id: 'j', eventId: 'E', idempotencyKey: 'k', leafHash: 'h',
      je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: 'GHOST', lines: [
        { account: 'a', side: 'DEBIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' },
        { account: 'b', side: 'CREDIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'y' },
      ] } };
    wrap(<EventLineage event={ev({ ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.5, reasoning: '' } })} entityId="e" journal={[je]} />);
    expect(screen.getByText(/REVERSAL OF → GHOST/)).toBeInTheDocument();
  });
  it('multi-currency JE that balances in functional but not origQty shows balanced ✓ + memo', () => {
    const je: JournalDTO = { id: 'j', eventId: 'E', idempotencyKey: 'k', leafHash: 'h',
      je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: null, lines: [
        { account: 'SUI', side: 'DEBIT', amountMinor: '100', origCoinType: '0x2::sui::SUI', origQtyMinor: '5', priceRef: null, fxRef: null, leg: 'in' },
        { account: 'USDC', side: 'CREDIT', amountMinor: '100', origCoinType: '0x..::usdc::USDC', origQtyMinor: '100', priceRef: null, fxRef: null, leg: 'out' },
      ] } };
    wrap(<EventLineage event={ev({ ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.9, reasoning: '' } })} entityId="e" journal={[je]} />);
    expect(screen.getByText(/Δ 0 ✓/)).toBeInTheDocument();
    expect(screen.getByText(/memo/i)).toBeInTheDocument();
  });
});
