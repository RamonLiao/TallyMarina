import { render, screen } from '@testing-library/react';
import { EventCompare } from './EventCompare';
import type { EventDTO } from '../../api/types';

const ev = (id: string, type: string): EventDTO => ({
  id, entityId: 'e', status: 'POSTED', normalized: {},
  ai: { eventType: type, purpose: 'p', counterparty: null, confidence: 0.9, reasoning: '' },
  final: null, routing: null,
});

it('renders one column per compared event', () => {
  render(<EventCompare events={[ev('A', 'SWAP'), ev('B', 'SWAP')]} journal={[]} />);
  expect(screen.getByRole('button', { name: /open lineage for A/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open lineage for B/i })).toBeInTheDocument();
});

it('marks a differing dimension with a non-color Δ label (a11y)', () => {
  render(<EventCompare events={[ev('A', 'SWAP'), ev('B', 'TRANSFER')]} journal={[]} />);
  // SR-only "differs" label present on the differing eventType row
  expect(screen.getAllByText(/differs/i).length).toBeGreaterThan(0);
});

it('shows a legible cap notice when more than 4 events are selected', () => {
  const events = ['A', 'B', 'C', 'D', 'E'].map((id) => ev(id, 'SWAP'));
  render(<EventCompare events={events} journal={[]} />);
  expect(screen.getByText(/4 of 5/i)).toBeInTheDocument();
});
