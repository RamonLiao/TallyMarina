import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../components/chrome/EmptyState';
import { ExceptionList } from '../components/data/ExceptionList';

describe('exceptions monkey', () => {
  it('clear-seas empty state celebrates with a blocking-zero message', () => {
    render(<EmptyState variant="clear-seas" />);
    expect(screen.getAllByText(/clear seas|ready to close|0 exceptions/i).length).toBeGreaterThan(0);
  });
  it('ExceptionList renders nothing dangerous with empty input', () => {
    const { container } = render(<ExceptionList exceptions={[]} selectedId={null} onSelect={() => {}} />);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
  it('handles a category it does not special-case without crashing', () => {
    // forge an unknown-ish severity ordering; component must not throw
    render(<ExceptionList exceptions={[{ exceptionId: 'RULES_FAILED:x', category: 'RULES_FAILED', eventId: 'x', severity: 3, reason: 'r', amount: null, ai: null, disposition: { state: 'dismissed', reasonCode: 'OTHER', decidedBy: 'a', decidedAt: 0 }, anchoredReadOnly: false }]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/dismissed/i)).toBeInTheDocument();
  });
});
