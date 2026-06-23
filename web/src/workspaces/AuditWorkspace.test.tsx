import { render, screen, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditWorkspace } from './AuditWorkspace';
import type { EntityDTO, EventDTO } from '../api/types';

// Mock context and hooks so we control entity + events without network
const mockEntityCtx = vi.fn();
vi.mock('../app/EntityContext', () => ({
  useEntityCtx: () => mockEntityCtx(),
}));

const mockEvents = vi.fn();
const mockJournal = vi.fn();
vi.mock('../api/hooks', () => ({
  useEvents: () => mockEvents(),
  useJournal: () => mockJournal(),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const entity = (id: string): EntityDTO => ({ id, displayName: `Entity ${id}`, chainObjectId: 'c', capObjectId: 'cap', originalPackageId: 'pkg' });
const ev = (id: string): EventDTO => ({
  id, entityId: 'e', status: 'POSTED', normalized: {}, ai: null, final: null, routing: null,
});

it('resets selection to pick state when entity changes', async () => {
  mockJournal.mockReturnValue({ data: [] });

  // Step 1: render with entity E1 and events
  mockEntityCtx.mockReturnValue({ entity: entity('e_A') });
  mockEvents.mockReturnValue({ data: [ev('evt_1'), ev('evt_2')] });

  const { rerender } = wrap(<AuditWorkspace />);

  // Verify initial pick state — back button not visible yet
  expect(screen.queryByText(/‹ Events/)).not.toBeInTheDocument();
  expect(screen.getByText(/select an exception/i)).toBeInTheDocument();

  // Step 2: click an event row to select it — back button appears
  const rowButtons = screen.getAllByRole('button', { name: /evt_/i });
  const firstRow = rowButtons[0];
  if (!firstRow) throw new Error('No event row buttons found');
  await act(async () => { fireEvent.click(firstRow); });

  // ASSERT selection is active: back button "‹ Events" is visible, pick-one EmptyState gone
  expect(screen.getByText(/‹ Events/)).toBeInTheDocument();
  expect(screen.queryByText(/select an exception/i)).not.toBeInTheDocument();

  // Step 3: switch to entity E2 — useEffect should reset selectedId → null
  mockEntityCtx.mockReturnValue({ entity: entity('e_B') });
  mockEvents.mockReturnValue({ data: [ev('evt_3')] });

  const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    rerender(<QueryClientProvider client={qc2}><AuditWorkspace /></QueryClientProvider>);
  });

  // ASSERT selection cleared: back button gone, pick-one EmptyState restored
  expect(screen.queryByText(/‹ Events/)).not.toBeInTheDocument();
  expect(screen.getByText(/select an exception/i)).toBeInTheDocument();
});

it('shows pick-state empty pane on initial render with events', () => {
  mockEntityCtx.mockReturnValue({ entity: entity('e_A') });
  mockEvents.mockReturnValue({ data: [ev('evt_1')] });
  mockJournal.mockReturnValue({ data: [] });

  wrap(<AuditWorkspace />);
  // No selection → detail pane shows pick-one empty state (not a lineage)
  expect(screen.queryByText(/Raw event/i)).not.toBeInTheDocument();
});
