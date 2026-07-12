// web/src/workspaces/close/CloseCockpit.stale.test.tsx
// WHY: 'stale' is a real blocking status (spec D12/D13) — a revaluation light gone stale
// (prices/lots moved since the last run) must block lock exactly like 'red' does. This is
// the Task 11 wiring test: verdict count, LockPanel blockers list, and the lock button
// disabled state must all treat 'stale' as blocking, driven off closeable (not re-derived
// client-side from the lights array).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CloseCockpit } from './CloseCockpit';
import { LockPanel } from './LockPanel';
import type { CloseCockpitResponse } from '../../api/types';

function cockpit(overrides: Partial<CloseCockpitResponse> = {}): CloseCockpitResponse {
  return {
    lights: [
      { key: 'revaluation', status: 'stale', label: 'Revaluation', real: true },
    ],
    status: 'OPEN', anchored: false, closeable: false, reopenCount: 0,
    restatementReason: null, reasonCode: null, staleAnchor: false,
    anchorStaleness: null,
    ...overrides,
  };
}

vi.mock('../../data/useCloseCockpit', () => ({
  useCloseCockpit: vi.fn(),
}));
vi.mock('../../app/WorkspaceContext', () => ({ useWorkspace: () => ({ setWorkspace: vi.fn() }) }));
vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ setStep: vi.fn(), periodId: '2026-Q2' }) }));

import { useCloseCockpit } from '../../data/useCloseCockpit';

describe('CloseCockpit stale revaluation light', () => {
  // Single render tree: CloseCockpit renders LockPanel internally with the SAME data, so
  // one render proves the verdict count, the blockers list, and the disabled lock button
  // all agree that stale blocks — a split render could miss a wrong-data-forwarding bug.
  it('counts a stale light in the verdict, names it as a blocker, and disables lock', () => {
    vi.mocked(useCloseCockpit).mockReturnValue({ data: cockpit(), loading: false, error: undefined, refetch: vi.fn() });
    render(<CloseCockpit entityId="e1" />);
    expect(screen.getByText(/1 light blocking close/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lock/i })).toBeDisabled();
    expect(screen.getByText(/Locked out by:/i)).toHaveTextContent(/revaluation/i);
  });
});

describe('LockPanel stale blocker', () => {
  it('lists a stale revaluation light as a blocker and disables lock', () => {
    const data = cockpit();
    render(<LockPanel data={data} entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/revaluation/i);
  });
});
