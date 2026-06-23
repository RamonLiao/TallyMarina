// web/src/workspaces/close/CloseCockpit.test.tsx — mock the hook
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CloseCockpit } from './CloseCockpit';

vi.mock('../../data/useCloseCockpit', () => ({
  useCloseCockpit: () => ({
    data: { lights: [
      { key: 'recon', status: 'red', label: 'Reconciliation', real: true },
      { key: 'je', status: 'green', label: 'JE', real: true },
    ], status: 'OPEN', anchored: false, staleAnchor: false, closeable: false, reopenCount: 0, restatementReason: null, reasonCode: null },
    loading: false, error: undefined, refetch: vi.fn(),
  }),
}));
vi.mock('../../app/WorkspaceContext', () => ({ useWorkspace: () => ({ setWorkspace: vi.fn() }) }));
vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ setStep: vi.fn() }) }));

it('shows an aria-live verdict counting blocking lights', () => {
  render(<CloseCockpit entityId="e1" />);
  // WHY: the verdict must be reachable without scanning six cards (a11y + glanceability).
  // Multiple role=status exist (verdict + LockPanel blocker); the cockpit verdict has aria-live.
  const statuses = screen.getAllByRole('status');
  const verdict = statuses.find((el) => el.getAttribute('aria-live') === 'polite');
  expect(verdict).toHaveTextContent(/1 light/i);
});

it('renders the period status chip', () => {
  render(<CloseCockpit entityId="e1" />);
  expect(screen.getByText('OPEN')).toBeInTheDocument();
});
