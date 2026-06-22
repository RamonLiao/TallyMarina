/**
 * Mascot governance tests — spec §8.4 enforcement.
 *
 * WHY THESE TESTS MATTER:
 * The otter mascot is for personality/chrome (empty states, copilot dock,
 * celebration). It must NEVER appear inside data-surface components
 * (JournalTable, HashChain, GuardrailBanner, ConfidenceBar).
 * These tests will fail the moment a `<Mascot>` import is added to any
 * DATA ZONE component — enforcing the trust boundary between decorative
 * UI and financial data displays.
 *
 * Also tests: AI has no posting authority (the HUMAN's "decide" call, not AI).
 */
import { render, screen } from '@testing-library/react';
import { JournalTable } from '../components/data/JournalTable';
import { HashChain } from '../components/data/HashChain';
import { GuardrailBanner } from '../components/data/GuardrailBanner';
import { ConfidenceBar } from '../components/data/ConfidenceBar';
import type { JournalDTO, AnchorDTO } from '../api/types';

const journal: JournalDTO[] = [{ id: 'j1', eventId: 'e1', idempotencyKey: 'k', leafHash: '0xabc1234567', je: { idempotencyKey: 'k', lineageHash: '0xL', reversalOf: null, lines: [{ account: 'A', side: 'DEBIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null }] } }];
const anchors: AnchorDTO[] = [{ id: 'a1', snapshotId: 's1', seq: 1, link: '0xLINK0001', digest: '0xDIG0001', explorerUrl: 'https://x', anchoredAt: 't' }];

// §8.4 — JournalTable is a DATA ZONE. Any otter img here breaks the trust boundary.
it('renders NO otter mascot in the journal table (§8.4)', () => {
  render(<JournalTable journal={journal} />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});

// §8.4 SINGLE MOST IMPORTANT BOUNDARY — block explorer view must stay austere.
it('renders NO otter mascot in the hash-chain view (§8.4 single most important boundary)', () => {
  render(<HashChain anchors={anchors} inclusionProof={null} />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});

// §8.4 — neither the AI's leash banner nor the confidence bar are personality zones.
it('renders NO otter mascot in the guardrail banner or confidence bar (§8.4)', () => {
  const { rerender } = render(<GuardrailBanner />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
  rerender(<ConfidenceBar confidence={0.9} />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});

// AI no-posting-authority: GuardrailBanner must declare "AI suggestions only".
// Removing or softening this copy breaks the product thesis (§8.4 + §8.5).
it('guardrail banner declares AI suggestions only — no posting authority', () => {
  render(<GuardrailBanner />);
  expect(screen.getByText(/AI suggestions only/i)).toBeInTheDocument();
  expect(screen.getByText(/no posting authority/i)).toBeInTheDocument();
});

// Data surfaces must be opaque — AppBackground must NOT bleed through financial data.
// The test passes if background is var(--navy-deep) or var(--paper-card) (non-transparent).
it('JournalTable thead uses var(--navy-deep) — opaque, not transparent (§8.4 data opacity)', () => {
  const { container } = render(<JournalTable journal={journal} />);
  const thead = container.querySelector('thead tr');
  expect(thead).toBeTruthy();
  // background is set via inline style — verify it is the correct CSS var, not empty/transparent
  const bg = (thead as HTMLElement).style.background;
  expect(bg).toBe('var(--navy-deep)');
});

it('JournalTable tbody rows use var(--paper-card) — opaque, not transparent (§8.4 data opacity)', () => {
  const { container } = render(<JournalTable journal={journal} />);
  const bodyRow = container.querySelector('tbody tr');
  expect(bodyRow).toBeTruthy();
  const bg = (bodyRow as HTMLElement).style.background;
  expect(bg).toBe('var(--paper-card)');
});
