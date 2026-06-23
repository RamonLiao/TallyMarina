import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventLineage } from './EventLineage';
import type { EventDTO, JournalDTO } from '../../api/types';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const event = (over: Partial<EventDTO> = {}): EventDTO => ({
  id: 'evt_A', entityId: 'e', status: 'POSTED', normalized: { txDigest: '0xabc' },
  ai: { eventType: 'TOKEN_SWAP', purpose: 'swap', counterparty: null, confidence: 0.92, reasoning: 'r' },
  final: null, routing: null, ...over,
});

const je = (over: Partial<JournalDTO> = {}): JournalDTO => ({
  id: 'je1', eventId: 'evt_A', idempotencyKey: 'k1', leafHash: 'aa',
  je: { idempotencyKey: 'k1', lineageHash: 'LIN123', reversalOf: null, lines: [
    { account: 'SUI', side: 'DEBIT', amountMinor: '312', origCoinType: null, origQtyMinor: null, priceRef: 'p1', fxRef: null, leg: 'in' },
    { account: 'USDC', side: 'CREDIT', amountMinor: '312', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'out' },
  ] }, ...over,
});

it('renders all four stage headers', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/Raw event/i)).toBeInTheDocument();
  expect(screen.getByText(/Classification/i)).toBeInTheDocument();
  expect(screen.getByText(/Journal entry/i)).toBeInTheDocument();
  expect(screen.getByText(/On-chain/i)).toBeInTheDocument();
});

it('shows the balance footer Δ=0 for a balanced JE', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/Δ 0/)).toBeInTheDocument();
});

it('surfaces lineageHash (1.6) in the chain stage', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/LIN123/)).toBeInTheDocument();
});

it('labels priceRef/fxRef as unresolved pointers (1.4 deferred)', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/p1/)).toBeInTheDocument();
  expect(screen.getAllByText(/unresolved pointer/i).length).toBeGreaterThan(0);
});

it('shows pending copy when the event is unclassified', () => {
  wrap(<EventLineage event={event({ ai: null, status: 'INGESTED' })} entityId="e" journal={[]} />);
  expect(screen.getByText(/awaiting classification/i)).toBeInTheDocument();
  expect(screen.getByText(/not yet posted/i)).toBeInTheDocument();
});

it('shows reversal badge when reversalOf is set (1.5)', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je({ je: { ...je().je, reversalOf: 'k0' } })]} />);
  expect(screen.getByText(/reversal of/i)).toBeInTheDocument();
});

it('renders inline error for a JE with malformed amountMinor without crashing other stages', () => {
  const badJe = je({
    je: {
      ...je().je,
      lines: [
        { account: 'SUI', side: 'DEBIT', amountMinor: 'oops', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'in' },
        { account: 'USDC', side: 'CREDIT', amountMinor: 'oops', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'out' },
      ],
    },
  });
  wrap(<EventLineage event={event()} entityId="e" journal={[badJe]} />);
  // malformed amount shows inline error
  expect(screen.getByText(/malformed amount/i)).toBeInTheDocument();
  // other stages still render (no crash, ① Raw and ② Classification still present)
  expect(screen.getByText(/Raw event/i)).toBeInTheDocument();
  expect(screen.getByText(/Classification/i)).toBeInTheDocument();
  expect(screen.getByText(/On-chain/i)).toBeInTheDocument();
});
