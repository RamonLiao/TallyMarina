import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PolicyWorkspace } from './PolicyWorkspace';

vi.mock('../../data/usePolicyData', () => ({
  usePolicyData: () => ({
    loading: false, error: undefined, refetch: vi.fn(),
    data: {
      policy: { policySet: { policySetVersion: 'demo-ps-1', assetPolicyVersion: 'a', eventPolicyVersion: 'e', ruleVersion: 'r', parserVersion: 'p', normalizationVersion: 'n', costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true },
        coaMapping: { rules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' }], defaultAccount: 'Suspense' }, periodId: '2026-Q2' },
      journal: [], events: [],
    },
  }),
}));
vi.mock('../../app/EntityContext', () => ({
  useEntityCtx: () => ({
    entity: { id: 'acme:pilot-001' },
    setEntity: vi.fn(),
    step: 'policy' as const,
    setStep: vi.fn(),
    goNext: vi.fn(),
    periodId: '2026-Q2',
  }),
}));

it('renders active policy version + COA mapping + preview safe-state badge', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getByText('demo-ps-1')).toBeInTheDocument());
  expect(screen.getByText('PERIOD OPEN')).toBeInTheDocument();
  expect(screen.getByText('PREVIEW — NOT APPLIED')).toBeInTheDocument();
  expect(screen.getAllByText(/method locked/i)).toHaveLength(2);
});
