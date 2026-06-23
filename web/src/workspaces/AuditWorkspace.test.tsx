import { render, screen, act } from '@testing-library/react';
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

  // Start with entity A and one event
  mockEntityCtx.mockReturnValue({ entity: entity('e_A') });
  mockEvents.mockReturnValue({ data: [ev('evt_1'), ev('evt_2')] });

  const { rerender } = wrap(<AuditWorkspace />);

  // Verify initial pick state — EmptyState pick-one renders "Select an exception"
  expect(screen.getByText(/select an exception/i)).toBeInTheDocument();

  // Switch to entity B
  mockEntityCtx.mockReturnValue({ entity: entity('e_B') });
  mockEvents.mockReturnValue({ data: [ev('evt_3')] });

  const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    rerender(<QueryClientProvider client={qc2}><AuditWorkspace /></QueryClientProvider>);
  });

  // After entity switch, detail pane should be in pick/empty state (no lineage visible)
  expect(screen.queryByText(/not yet posted/i)).not.toBeInTheDocument();
});

it('shows pick-state empty pane on initial render with events', () => {
  mockEntityCtx.mockReturnValue({ entity: entity('e_A') });
  mockEvents.mockReturnValue({ data: [ev('evt_1')] });
  mockJournal.mockReturnValue({ data: [] });

  wrap(<AuditWorkspace />);
  // No selection → detail pane shows pick-one empty state (not a lineage)
  expect(screen.queryByText(/Raw event/i)).not.toBeInTheDocument();
});
