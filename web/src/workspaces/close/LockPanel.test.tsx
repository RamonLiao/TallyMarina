// web/src/workspaces/close/LockPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    render(<LockPanel data={base} entityId="e1" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeDisabled();
    // WHY: blocker must be visible inline on touch — assert the name is in a status region.
    expect(screen.getByRole('status')).toHaveTextContent(/recon/i);
  });

  it('enables Lock when closeable and OPEN', () => {
    render(<LockPanel data={{ ...base, lights: [], closeable: true }} entityId="e1" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeEnabled();
  });
});
