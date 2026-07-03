import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentProposalCard } from './AgentProposalCard';
import type { ProposalDTO, ExceptionDTO } from '../../api/types';

const proposal: ProposalDTO = {
  id: 7, exceptionId: 'CLASSIFY_REVIEW:ev-1', eventId: 'ev-1', entityId: 'e1', periodId: '2026-Q2',
  action: 'deferred', reasonCode: 'PENDING_DOC', reasonNote: null,
  rationale: 'Missing the counterparty invoice; park it pending documentation.',
  confidence: 0.82, status: 'proposed', model: 'm2', createdAt: 1,
};
const exception: ExceptionDTO = {
  exceptionId: 'CLASSIFY_REVIEW:ev-1', category: 'CLASSIFY_REVIEW', eventId: 'ev-1', severity: 2,
  reason: 'r', amount: '100', ai: null, disposition: null, anchoredReadOnly: false,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('AgentProposalCard', () => {
  it('renders draft affordance, mono confidence text, consequence-named Accept CTA', () => {
    wrap(<AgentProposalCard proposal={proposal} exception={exception} entityId="e1" />);
    expect(screen.getByText(/AGENT PROPOSAL · NOT APPLIED/i)).toBeInTheDocument();
    expect(screen.getByText('confidence 0.82')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept — deferred as PENDING_DOC' })).toHaveClass('btn-primary');
    expect(screen.getByText(proposal.rationale)).toBeInTheDocument();
    // NOT the AUTO/threshold ConfidenceBar semantics
    expect(screen.queryByText(/AUTO/)).toBeNull();
  });

  it('shows the will-NOT-post warning only for dismissed proposals', () => {
    const { rerender } = wrap(<AgentProposalCard proposal={proposal} exception={exception} entityId="e1" />);
    expect(screen.queryByText(/will NOT post/)).toBeNull();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AgentProposalCard proposal={{ ...proposal, action: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED' }} exception={exception} entityId="e1" />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/will NOT post/)).toBeInTheDocument();
  });

  it('renders reasonNote when present (OTHER contract)', () => {
    wrap(<AgentProposalCard proposal={{ ...proposal, reasonCode: 'OTHER', reasonNote: 'weird one-off' }} exception={exception} entityId="e1" />);
    expect(screen.getByText(/weird one-off/)).toBeInTheDocument();
  });

  it('Accept POSTs to /triage/proposals/:id/accept', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    wrap(<AgentProposalCard proposal={proposal} exception={exception} entityId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: /^Accept — / }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain('/triage/proposals/7/accept');
  });

  it('Reject expands optional note then confirms', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    wrap(<AgentProposalCard proposal={proposal} exception={exception} entityId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    fireEvent.change(screen.getByPlaceholderText(/why/i), { target: { value: 'not a duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject' }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain('/triage/proposals/7/reject');
    expect(spy.mock.calls[0]![1]?.body).toContain('not a duplicate');
  });

  it('hidden when anchoredReadOnly', () => {
    wrap(<AgentProposalCard proposal={proposal} exception={{ ...exception, anchoredReadOnly: true }} entityId="e1" />);
    expect(screen.queryByText(/AGENT PROPOSAL/)).toBeNull();
  });
});
