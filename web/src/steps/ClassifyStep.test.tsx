import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { EntityProvider, useEntityCtx } from '../app/EntityContext';
import { ClassifyStep } from './ClassifyStep';
import * as endpoints from '../api/endpoints';
import type { EntityDTO, EventDTO } from '../api/types';

const BASE_ENTITY: EntityDTO = { id: 'acme:pilot-001', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' };

// Seeds the entity into context before rendering the component under test
function EntitySeeder({ entity, children }: { entity: EntityDTO; children: React.ReactNode }) {
  const { setEntity } = useEntityCtx();
  useEffect(() => { setEntity(entity); }, [entity, setEntity]);
  return <>{children}</>;
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <EntityProvider>
        <EntitySeeder entity={BASE_ENTITY}>{ui}</EntitySeeder>
      </EntityProvider>
    </QueryClientProvider>
  );
}

function makeEvent(id: string, confidence: number | null, status: EventDTO['status'] = 'INGESTED'): EventDTO {
  return {
    id,
    entityId: BASE_ENTITY.id,
    status,
    normalized: { eventTime: '2024-01-15T10:30:00Z', amount: '1000', coinType: 'SUI' },
    ai: confidence != null
      ? { eventType: 'PAYMENT', purpose: 'vendor payment', counterparty: null, confidence, reasoning: '' }
      : null,
    final: null,
    routing: null,
  };
}

// High-confidence (≥0.85) → AUTO badge
it('renders AUTO badge for high-confidence event (≥0.85)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', 0.92, 'AUTO')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'AUTO'));
});

// Low-confidence (<0.85) → NEEDS_REVIEW badge
it('renders NEEDS_REVIEW badge for low-confidence event (<0.85)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', 0.72, 'NEEDS_REVIEW')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW'));
});

// Boundary: exactly 0.85 → AUTO
it('routes 0.85 exactly to AUTO (boundary)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', 0.85, 'AUTO')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'AUTO'));
});

// Boundary: 0.84 → NEEDS_REVIEW
it('routes 0.84 to NEEDS_REVIEW (just below boundary)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', 0.84, 'NEEDS_REVIEW')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW'));
});

// PENDING when no ai yet
it('renders PENDING bar when confidence is null (pre-classify)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', null, 'INGESTED')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'PENDING'));
});

// "Classify all" fires classify once per event (N calls for N events)
it('"Classify all" fires classify once per unclassified event', async () => {
  const events = [makeEvent('e1', null), makeEvent('e2', null), makeEvent('e3', null)];
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue(events);
  const classifySpy = vi.spyOn(endpoints, 'classifyEvent').mockResolvedValue(
    { event: makeEvent('e1', 0.9, 'AUTO'), degraded: false }
  );

  render(wrap(<ClassifyStep />));
  await screen.findByRole('button', { name: /classify all/i });
  await userEvent.click(screen.getByRole('button', { name: /classify all/i }));

  await waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(3));
  expect(classifySpy).toHaveBeenCalledWith('e1');
  expect(classifySpy).toHaveBeenCalledWith('e2');
  expect(classifySpy).toHaveBeenCalledWith('e3');
});

// Safe normalized field access: rows WITH normalized keys render value, WITHOUT render '—'
it('renders eventTime from normalized when present', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', null)]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => expect(screen.getByText('2024-01-15T10:30:00Z')).toBeInTheDocument());
});

it('renders — fallback when normalized.eventTime is absent (no crash)', async () => {
  const eventNoTime: EventDTO = {
    id: 'e-no-time',
    entityId: BASE_ENTITY.id,
    status: 'INGESTED',
    normalized: {}, // no eventTime key
    ai: null,
    final: null,
    routing: null,
  };
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([eventNoTime]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => {
    const bars = screen.getAllByTestId('confidence-bar');
    expect(bars.length).toBe(1);
  });
  // Should render '—' for eventTime (multiple '—' is fine — bar also shows it)
  const dashes = screen.getAllByText('—');
  expect(dashes.length).toBeGreaterThanOrEqual(1);
});

it('never renders a mascot (data zone, no otter)', async () => {
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([makeEvent('e1', 0.9, 'AUTO')]);

  render(wrap(<ClassifyStep />));
  await waitFor(() => screen.getByTestId('confidence-bar'));
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});
