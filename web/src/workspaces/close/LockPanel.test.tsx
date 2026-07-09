// web/src/workspaces/close/LockPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockPanel } from './LockPanel';

const base = {
  lights: [{ key: 'recon', status: 'red' as const, label: 'Reconciliation', real: true }],
  status: 'OPEN' as const,
  anchored: false,
  staleAnchor: false,
  closeable: false,
  reopenCount: 0,
  restatementReason: null,
  reasonCode: null,
  anchorStaleness: null,
};

describe('LockPanel', () => {
  it('disables Lock and NAMES the blocker (not a tooltip)', () => {
    render(<LockPanel data={base} entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeDisabled();
    // WHY: blocker must be visible inline on touch — assert the name is in a status region.
    expect(screen.getByRole('status')).toHaveTextContent(/recon/i);
  });

  it('enables Lock when closeable and OPEN', () => {
    render(<LockPanel data={{ ...base, lights: [], closeable: true }} entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeEnabled();
  });

  it('POSTs the periodId being locked', async () => {
    // WHY: /period/lock 400s with PERIOD_ID_REQUIRED on an empty body. A lock that never
    // reaches the server leaves the period OPEN, and every later Freeze dies on
    // 409 PERIOD_NOT_LOCKED with no visible cause.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<LockPanel data={{ ...base, lights: [], closeable: true }} entityId="e1" periodId="2026-Q2" onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: /lock/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { periodId: string };
    expect(body.periodId).toBe('2026-Q2');
    vi.unstubAllGlobals();
  });
});
