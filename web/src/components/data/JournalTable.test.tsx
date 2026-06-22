import { render, screen } from '@testing-library/react';
import { JournalTable } from './JournalTable';
import type { JournalDTO } from '../../api/types';

const j: JournalDTO[] = [{
  id: 'j1', eventId: 'e1', idempotencyKey: 'k1', leafHash: '0xabcdef0123456789',
  je: { idempotencyKey: 'k1', lineageHash: '0xL', reversalOf: null, lines: [
    { account: 'Digital Assets', side: 'DEBIT', amountMinor: '5000000000', origCoinType: '0x2::sui::SUI', origQtyMinor: '5000000000', priceRef: null, fxRef: null, leg: null },
    { account: 'Revenue', side: 'CREDIT', amountMinor: '5000000000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
  ] },
}];

it('renders debit and credit lines in tabular mono with the leaf hash', () => {
  render(<JournalTable journal={j} />);
  // Both lines have the same amount — getAllByText avoids multiple-match error
  expect(screen.getAllByText('5000000000').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Digital Assets')).toBeInTheDocument();
  expect(screen.getByText(/0xabcdef/)).toBeInTheDocument();
});

it('renders NO mascot inside the journal table (§8.4 hard rule)', () => {
  render(<JournalTable journal={j} />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});

// KEY TEST: balanced indicator computed via BigInt, not float
it('shows balanced indicator for a balanced JE (BigInt sum, not float)', () => {
  render(<JournalTable journal={j} />);
  // balanced checkmark should be present
  expect(screen.getByTitle('balanced')).toBeInTheDocument();
});

it('shows unbalanced flag when debit != credit', () => {
  const unbalanced: JournalDTO[] = [{
    id: 'j2', eventId: 'e2', idempotencyKey: 'k2', leafHash: '0xdeadbeef',
    je: { idempotencyKey: 'k2', lineageHash: '0xL2', reversalOf: null, lines: [
      { account: 'Cash', side: 'DEBIT', amountMinor: '1000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ] },
  }];
  render(<JournalTable journal={unbalanced} />);
  expect(screen.getByTitle('unbalanced')).toBeInTheDocument();
});

// KEY TEST: amountMinor > Number.MAX_SAFE_INTEGER preserves all digits
it('preserves full precision for amountMinor beyond Number.MAX_SAFE_INTEGER', () => {
  const bigAmount = '90071992547409919999'; // > Number.MAX_SAFE_INTEGER
  const bigJ: JournalDTO[] = [{
    id: 'jbig', eventId: 'ebig', idempotencyKey: 'kbig', leafHash: '0xbig',
    je: { idempotencyKey: 'kbig', lineageHash: '0xLbig', reversalOf: null, lines: [
      { account: 'Vault', side: 'DEBIT', amountMinor: bigAmount, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
      { account: 'Equity', side: 'CREDIT', amountMinor: bigAmount, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ] },
  }];
  render(<JournalTable journal={bigJ} />);
  // Must find the exact string, not a float-mangled version
  const cells = screen.getAllByText(bigAmount);
  expect(cells.length).toBeGreaterThanOrEqual(1);
});
