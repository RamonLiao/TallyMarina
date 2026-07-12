import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PolicyHistoryCard } from './PolicyHistoryCard';
import { getPolicyHistory } from '../../api/endpoints';

vi.mock('../../api/endpoints', () => ({
  getPolicyHistory: vi.fn().mockResolvedValue({
    changes: [{ seq: 1, entityId: 'acme:pilot-001', actor: 'controller', at: '2026-07-01T00:00:00Z', objectType: 'POLICY_SET', objectRef: 'v1', before: null, after: '{"a":1}', reason: 'initial setup' }],
    policyVersions: [], coaVersions: [],
  }),
}));

it('refetches history when refreshKey changes after a successful apply', async () => {
  const { rerender } = render(<PolicyHistoryCard entityId="acme:pilot-001" refreshKey="1:1" />);
  await waitFor(() => expect(screen.getByText(/initial setup/)).toBeInTheDocument());
  expect(getPolicyHistory).toHaveBeenCalledTimes(1);

  // Simulate a successful apply bumping the version-derived refreshKey.
  rerender(<PolicyHistoryCard entityId="acme:pilot-001" refreshKey="1:2" />);
  await waitFor(() => expect(getPolicyHistory).toHaveBeenCalledTimes(2));
});

it('does not refetch when refreshKey is unchanged (same props re-render)', async () => {
  const { rerender } = render(<PolicyHistoryCard entityId="acme:pilot-001" refreshKey="1:1" />);
  await waitFor(() => expect(getPolicyHistory).toHaveBeenCalled());
  const callsAfterMount = (getPolicyHistory as ReturnType<typeof vi.fn>).mock.calls.length;

  rerender(<PolicyHistoryCard entityId="acme:pilot-001" refreshKey="1:1" />);
  await waitFor(() => expect(screen.getByText(/initial setup/)).toBeInTheDocument());
  expect(getPolicyHistory).toHaveBeenCalledTimes(callsAfterMount);
});
