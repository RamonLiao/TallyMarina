import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityProvider } from '../app/EntityContext';
import { IngestStep } from './IngestStep';
import * as endpoints from '../api/endpoints';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><EntityProvider>{ui}</EntityProvider></QueryClientProvider>;
}

it('loads the seeded entity then ingests fixture events', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([
    { id: 'acme:pilot-001', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
  ]);
  vi.spyOn(endpoints, 'ingest').mockResolvedValue({ ingested: 7, events: [] });

  render(wrap(<IngestStep />));
  await screen.findByText('Acme Pilot');
  await userEvent.click(screen.getByRole('button', { name: /ingest/i }));
  await waitFor(() => expect(screen.getByText(/7/)).toBeInTheDocument());
});

it('shows empty state when no entity exists', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([]);

  render(wrap(<IngestStep />));
  await waitFor(() => expect(screen.getByText(/No demo entity seeded\./)).toBeInTheDocument());
});

// NOTE: IngestStep itself renders NO events table (deferred to the Classify
// step). The opportunistic `normalized.eventTime`/amount safe-access rendering
// — and its `'—'` fallback for absent keys — lives with the events Table in a
// later step, and is asserted there. This test only verifies that ingest
// succeeds and reports its count when the payload carries event-bearing rows
// with heterogeneous `normalized` shapes (one with `eventTime`, one empty) —
// it does NOT claim to cover the safe-accessor rendering.
it('reports the ingested count for event-bearing payloads with mixed normalized shapes', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([
    { id: 'acme:pilot-001', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
  ]);
  vi.spyOn(endpoints, 'ingest').mockResolvedValue({
    ingested: 2,
    events: [
      { id: 'e1', entityId: 'acme:pilot-001', status: 'INGESTED' as const, normalized: { eventTime: '2024-01-01' }, ai: null, final: null, routing: {} as never },
      { id: 'e2', entityId: 'acme:pilot-001', status: 'INGESTED' as const, normalized: {}, ai: null, final: null, routing: {} as never },
    ],
  });

  render(wrap(<IngestStep />));
  await screen.findByText('Acme Pilot');
  await userEvent.click(screen.getByRole('button', { name: /ingest/i }));
  await waitFor(() => expect(screen.getByText(/Ingested 2 events/)).toBeInTheDocument());
});

it('button label changes to Ingesting… while pending', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([
    { id: 'acme:pilot-001', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
  ]);
  let resolve!: (v: { ingested: number; events: [] }) => void;
  vi.spyOn(endpoints, 'ingest').mockReturnValue(new Promise(r => { resolve = r; }));

  render(wrap(<IngestStep />));
  await screen.findByText('Acme Pilot');
  await userEvent.click(screen.getByRole('button', { name: /ingest fixture/i }));
  expect(screen.getByRole('button', { name: /ingesting/i })).toBeInTheDocument();
  resolve({ ingested: 0, events: [] });
});
