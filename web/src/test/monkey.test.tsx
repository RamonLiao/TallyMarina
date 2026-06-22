/**
 * Monkey tests — extreme / edge-case inputs designed to break the UI.
 * Rule: test.md mandates monkey testing after unit + integration.
 *
 * WHY THESE TESTS MATTER: Financial UIs that crash on null confidence or
 * large datasets are a production risk. Each test encodes a specific
 * exploit path (null/NaN fields, huge arrays, unsorted data) that would
 * cause real user-visible errors.
 */
import { render, screen } from '@testing-library/react';
import { ConfidenceBar } from '../components/data/ConfidenceBar';
import { JournalTable } from '../components/data/JournalTable';
import { HashChain } from '../components/data/HashChain';
import type { JournalDTO, AnchorDTO } from '../api/types';

// NULL confidence: pre-classify state — bar must render safely, routing=PENDING.
// If this crashes, the ClassifyStep row would throw before any classify call.
it('confidence bar tolerates null (pre-classify) without crashing', () => {
  render(<ConfidenceBar confidence={null} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'PENDING');
});

// NaN/out-of-range: malformed AI response must never auto-route erroneously.
// NaN → PENDING (no false positive routing). Out-of-range high → AUTO is acceptable
// (clamped fill), but PENDING/REVIEW would also be safe. The key constraint is:
// NaN must NOT be treated as >= threshold.
it('confidence bar tolerates NaN / out-of-range and never auto-routes NaN', () => {
  const { rerender } = render(<ConfidenceBar confidence={Number.NaN} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'PENDING');
  // out-of-range high (1.7 >= 0.85 threshold) — routes AUTO, fill clamps to 100%
  rerender(<ConfidenceBar confidence={1.7} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'AUTO');
});

// Negative confidence: must NOT auto-route (negative < threshold)
it('confidence bar routes NEEDS_REVIEW for negative confidence (never crashes)', () => {
  render(<ConfidenceBar confidence={-0.5} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW');
});

// Empty journal: table must still render the table element (not null/undefined crash).
it('journal table renders an empty journal without crashing', () => {
  render(<JournalTable journal={[]} />);
  expect(document.querySelector('table')).toBeTruthy();
});

// HUGE journal: 500 entries × 2 lines = 1000 rows. Must not exceed stack or OOM.
// If this crashes, a real period with many txns would break the Journal step.
it('journal table renders a HUGE journal (500 JEs) without throwing', () => {
  const big: JournalDTO[] = Array.from({ length: 500 }, (_, i) => ({
    id: `j${i}`, eventId: `e${i}`, idempotencyKey: `k${i}`, leafHash: `0x${i.toString(16).padStart(40, '0')}`,
    je: { idempotencyKey: `k${i}`, lineageHash: '0xL', reversalOf: null, lines: [
      { account: 'Digital Assets', side: 'DEBIT', amountMinor: '999999999999999999', origCoinType: '0x2::sui::SUI', origQtyMinor: '1', priceRef: null, fxRef: null, leg: null },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '999999999999999999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ] },
  }));
  render(<JournalTable journal={big} />);
  expect(screen.getAllByText('Digital Assets').length).toBe(500);
});

// Unsorted anchors + null inclusionProof: HashChain must sort by seq ascending.
// If sorting breaks, older anchors appear after newer ones — misleading audit trail.
it('hash-chain renders with a null inclusion proof and unsorted seqs', () => {
  const anchors: AnchorDTO[] = [
    { id: 'a2', snapshotId: 's', seq: 2, link: '0xL2', digest: '0xD2', explorerUrl: 'https://x', anchoredAt: 't' },
    { id: 'a1', snapshotId: 's', seq: 1, link: '0xL1', digest: '0xD1', explorerUrl: 'https://x', anchoredAt: 't' },
  ];
  render(<HashChain anchors={anchors} inclusionProof={null} />);
  // sorted ascending: seq #1 appears before seq #2 in the document
  const text = document.body.textContent ?? '';
  expect(text.indexOf('seq #1')).toBeLessThan(text.indexOf('seq #2'));
});

// Empty anchors list: HashChain must not crash and must show "No anchors yet"
it('hash-chain renders empty anchors without crashing', () => {
  render(<HashChain anchors={[]} inclusionProof={null} />);
  expect(screen.getByText(/no anchors yet/i)).toBeInTheDocument();
});

// BigInt amountMinor — very large string must not overflow to float.
// 999999999999999999 exceeds Number.MAX_SAFE_INTEGER; parsed as float → loss of precision.
it('journal table renders max-precision amountMinor as raw string (no float parse)', () => {
  const je: JournalDTO = {
    id: 'jbig', eventId: 'ebig', idempotencyKey: 'kbig', leafHash: '0xdeadbeef',
    je: { idempotencyKey: 'kbig', lineageHash: '0xL', reversalOf: null, lines: [
      { account: 'Wallet', side: 'DEBIT', amountMinor: '999999999999999999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '999999999999999999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ] },
  };
  render(<JournalTable journal={[je]} />);
  // Must render the exact string, not a rounded float like 1000000000000000000
  expect(screen.getAllByText('999999999999999999').length).toBeGreaterThan(0);
});
