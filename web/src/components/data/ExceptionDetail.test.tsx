import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExceptionDetail } from './ExceptionDetail';
import type { ProposalDTO, ExceptionDTO } from '../../api/types';

const proposal: ProposalDTO = {
  id: 7, exceptionId: 'RULES_FAILED:2', eventId: '2', entityId: 'e1', periodId: '2026-Q2',
  action: 'resolved', reasonCode: 'RECLASSIFIED', reasonNote: null,
  rationale: 'Looks like a routine reclass.', confidence: 0.9, status: 'proposed', model: 'm2', createdAt: 1,
};
const exception = (over: Partial<ExceptionDTO> = {}): ExceptionDTO => ({
  exceptionId: 'RULES_FAILED:2', category: 'RULES_FAILED', eventId: '2', severity: 3,
  reason: 'NO_MAPPING', amount: null, ai: null, disposition: null, anchoredReadOnly: false, ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('ExceptionDetail — proposal/disposition gating', () => {
  it('live proposal (open exception, status=proposed): shows card, divider, and demotes Resolve to a ghost button', () => {
    wrap(<ExceptionDetail exception={exception()} entityId="e1" proposal={proposal} />);
    expect(screen.getByText(/AGENT PROPOSAL/i)).toBeInTheDocument();
    expect(screen.getByText(/or decide manually/i)).toBeInTheDocument();
    // demoted → Resolve is NOT btn-primary
    expect(screen.getByRole('button', { name: /^resolve$/i })).not.toHaveClass('btn-primary');
  });

  // Regression: manually resolving an exception the agent already proposed on leaves the
  // proposal cache stale (still status=proposed) until triage-proposals is invalidated too.
  // ExceptionDetail must not show an orphaned "or decide manually" divider with no card above
  // it, nor keep DispositionControls demoted, once the exception itself is terminal.
  it('stale proposal (terminal exception, status still proposed): no card, no orphaned divider', () => {
    wrap(
      <ExceptionDetail
        exception={exception({ disposition: { state: 'resolved', reasonCode: 'RECLASSIFIED', decidedBy: 'x', decidedAt: 0 } })}
        entityId="e1"
        proposal={proposal}
      />,
    );
    expect(screen.queryByText(/AGENT PROPOSAL/i)).toBeNull();
    expect(screen.queryByText(/or decide manually/i)).toBeNull();
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
  });

  it('stale proposal (open exception, status no longer proposed): no card, no divider, Resolve NOT demoted', () => {
    wrap(<ExceptionDetail exception={exception()} entityId="e1" proposal={{ ...proposal, status: 'accepted' }} />);
    expect(screen.queryByText(/AGENT PROPOSAL/i)).toBeNull();
    expect(screen.queryByText(/or decide manually/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^resolve$/i })).toHaveClass('btn-primary');
  });

  it('stale proposal (anchoredReadOnly exception): no card, no divider', () => {
    wrap(<ExceptionDetail exception={exception({ anchoredReadOnly: true })} entityId="e1" proposal={proposal} />);
    expect(screen.queryByText(/AGENT PROPOSAL/i)).toBeNull();
    expect(screen.queryByText(/or decide manually/i)).toBeNull();
  });
});
