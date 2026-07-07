// web/src/workspaces/close/CloseCockpit.staleAnchor.test.tsx
// WHY: anchorStaleness is soft-force (§W-F1) — it must render as an amber "attention"
// chip, never the red "blocking" color, and it must name the anchored version so the
// user knows which on-chain root has drifted from the books.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CloseCockpit } from './CloseCockpit';
import type { CloseCockpitResponse } from '../../api/types';

function cockpit(overrides: Partial<CloseCockpitResponse> = {}): CloseCockpitResponse {
  return {
    lights: [], status: 'OPEN', anchored: true, closeable: false, reopenCount: 1,
    restatementReason: null, reasonCode: null, staleAnchor: true,
    anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aabbccddeeff0011', currentRoot: 'ffee', latestSnapshotSeq: 1 },
    ...overrides,
  };
}

vi.mock('../../data/useCloseCockpit', () => ({
  useCloseCockpit: vi.fn(),
}));
vi.mock('../../app/WorkspaceContext', () => ({ useWorkspace: () => ({ setWorkspace: vi.fn() }) }));
vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ setStep: vi.fn() }) }));

import { useCloseCockpit } from '../../data/useCloseCockpit';

describe('CloseCockpit stale anchor badge', () => {
  it('renders an amber (not red/blocking) chip naming the anchored version', () => {
    vi.mocked(useCloseCockpit).mockReturnValue({ data: cockpit(), loading: false, error: undefined, refetch: vi.fn() });
    render(<CloseCockpit entityId="e1" />);
    const badge = screen.getByText(/Books changed since anchor \(v1\)/i);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/stale-anchor/); // amber chip class, not a debit/blocking class
    expect(badge.className).not.toMatch(/debit|blocking/);
  });

  it('does not render the chip when anchorStaleness is null', () => {
    vi.mocked(useCloseCockpit).mockReturnValue({ data: cockpit({ anchorStaleness: null }), loading: false, error: undefined, refetch: vi.fn() });
    render(<CloseCockpit entityId="e1" />);
    expect(screen.queryByText(/Books changed since anchor/i)).not.toBeInTheDocument();
  });
});
