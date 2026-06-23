import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventList } from './EventList';
import type { EventDTO } from '../../api/types';

const ev = (over: Partial<EventDTO>): EventDTO => ({
  id: 'evt_1', entityId: 'e', status: 'POSTED', normalized: {}, ai: null, final: null, routing: null, ...over,
});

const base = {
  selectedId: null, compareIds: [] as string[],
  onSelect: () => {}, onToggleCompare: () => {},
  statusFilter: 'ALL' as const, onStatusFilter: () => {},
};

it('renders one row per event with its id', () => {
  render(<EventList {...base} events={[ev({ id: 'evt_A' }), ev({ id: 'evt_B' })]} />);
  expect(screen.getByText('evt_A')).toBeInTheDocument();
  expect(screen.getByText('evt_B')).toBeInTheDocument();
});

it('row body click selects for lineage; checkbox toggles compare (distinct targets)', async () => {
  const onSelect = vi.fn();
  const onToggleCompare = vi.fn();
  render(<EventList {...base} events={[ev({ id: 'evt_A' })]} onSelect={onSelect} onToggleCompare={onToggleCompare} />);
  await userEvent.click(screen.getByRole('button', { name: /evt_A/ }));
  expect(onSelect).toHaveBeenCalledWith('evt_A');
  await userEvent.click(screen.getByRole('checkbox', { name: /compare evt_A/i }));
  expect(onToggleCompare).toHaveBeenCalledWith('evt_A');
});

it('status filter narrows the visible rows', () => {
  render(
    <EventList {...base} statusFilter="POSTED"
      events={[ev({ id: 'evt_posted', status: 'POSTED' }), ev({ id: 'evt_review', status: 'NEEDS_REVIEW' })]} />,
  );
  expect(screen.getByText('evt_posted')).toBeInTheDocument();
  expect(screen.queryByText('evt_review')).not.toBeInTheDocument();
});

it('marks an unclassified event (ai null) with a pending tag', () => {
  render(<EventList {...base} events={[ev({ id: 'evt_p', status: 'INGESTED', ai: null })]} />);
  expect(screen.getByText(/pending/i)).toBeInTheDocument();
});
