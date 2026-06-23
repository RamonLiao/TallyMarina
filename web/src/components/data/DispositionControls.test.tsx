import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispositionControls } from './DispositionControls';
import type { ExceptionDTO } from '../../api/types';

const ex = (over: Partial<ExceptionDTO> = {}): ExceptionDTO => ({
  exceptionId: 'RULES_FAILED:2', category: 'RULES_FAILED', eventId: '2', severity: 3,
  reason: 'NO_MAPPING', amount: null, ai: null, disposition: null, anchoredReadOnly: false, ...over,
});
const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe('DispositionControls', () => {
  it('shows only valid transitions for open state (resolve/defer/dismiss)', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /defer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('dismiss requires a reason: confirm disabled until reasonCode chosen (ceremony)', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    // inline expansion appears with a required reason; explicit confirm is disabled initially
    const confirm = screen.getByRole('button', { name: /dismiss this exception/i });
    expect(confirm).toBeDisabled();
  });

  it('anchoredReadOnly disables all controls with an informational note', () => {
    render(wrap(<DispositionControls exception={ex({ anchoredReadOnly: true })} entityId="e1" />));
    expect(screen.getByText(/anchored/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
  });

  it('deferred exception renders Resolve and Dismiss but NOT Defer', () => {
    render(wrap(<DispositionControls
      exception={ex({ disposition: { state: 'deferred', reasonCode: 'PENDING_DOC', decidedBy: 'test', decidedAt: 0 } })}
      entityId="e1"
    />));
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /defer/i })).toBeNull();
  });

  it('resolved exception renders NO action buttons (terminal text)', () => {
    render(wrap(<DispositionControls
      exception={ex({ disposition: { state: 'resolved', reasonCode: 'RECLASSIFIED', decidedBy: 'test', decidedAt: 0 } })}
      entityId="e1"
    />));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
  });

  it('dismissed exception renders NO action buttons (terminal text)', () => {
    render(wrap(<DispositionControls
      exception={ex({ disposition: { state: 'dismissed', reasonCode: 'DUPLICATE_CONFIRMED', decidedBy: 'test', decidedAt: 0 } })}
      entityId="e1"
    />));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
  });

  it('resolve panel confirm disabled until reasonCode chosen', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    const confirm = screen.getByRole('button', { name: /confirm resolve/i });
    expect(confirm).toBeDisabled();
  });

  it('defer panel confirm disabled until reasonCode chosen', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    fireEvent.click(screen.getByRole('button', { name: /defer/i }));
    const confirm = screen.getByRole('button', { name: /confirm defer/i });
    expect(confirm).toBeDisabled();
  });
});
