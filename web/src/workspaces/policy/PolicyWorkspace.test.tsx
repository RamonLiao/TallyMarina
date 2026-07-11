import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { PolicyWorkspace } from './PolicyWorkspace';

const applyCoaMapping = vi.fn().mockResolvedValue(undefined);
const applyPolicyChanges = vi.fn().mockResolvedValue(undefined);
const refetch = vi.fn();

const policyDoc = {
  accountingStandard: 'US_GAAP' as const,
  functionalCurrency: 'USD', reportingCurrency: 'USD',
  costBasisMethod: 'FIFO' as const,
  stablecoinTreatment: 'CASH_EQUIVALENT' as const,
  cryptoClassificationDefault: 'INTANGIBLE_ASSET',
  stakingIncomePolicy: 'OPERATING_REVENUE' as const,
  feeExpensePolicy: 'EXPENSE_IMMEDIATE' as const,
  revaluationPolicy: 'cost' as const,
  asu202308Applies: {},
  policySetVersion: 'demo-ps-1', assetPolicyVersion: 'a', eventPolicyVersion: 'e',
  ruleVersion: 'r', parserVersion: 'p', normalizationVersion: 'n',
  roundingThresholdMinor: '0',
};

function baseData() {
  return {
    policy: {
      policySet: { policySetVersion: 'demo-ps-1', assetPolicyVersion: 'a', eventPolicyVersion: 'e', ruleVersion: 'r', parserVersion: 'p', normalizationVersion: 'n', costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true },
      coaMapping: { rules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' }], defaultAccount: 'Suspense', version: 3, ruleVersion: 'r' },
      periodId: '2026-Q2',
      policyDoc,
      policyVersion: 5,
      coaVersion: 3,
    },
    journal: [], events: [],
  };
}

vi.mock('../../data/usePolicyData', () => ({
  usePolicyData: () => ({
    loading: false, error: undefined, refetch,
    applyCoaMapping, applyPolicyChanges,
    data: baseData(),
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
vi.mock('../../api/endpoints', async () => {
  const actual = await vi.importActual<typeof import('../../api/endpoints')>('../../api/endpoints');
  return {
    ...actual,
    getPolicyHistory: vi.fn().mockResolvedValue({
      changes: [{ seq: 1, entityId: 'acme:pilot-001', actor: 'controller', at: '2026-07-01T00:00:00Z', objectType: 'POLICY_SET', objectRef: 'v5', before: null, after: '{"a":1}', reason: 'initial setup' }],
      policyVersions: [], coaVersions: [],
    }),
  };
});

it('renders active policy version + COA mapping + preview safe-state badge', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));
  expect(screen.getByText('PERIOD OPEN')).toBeInTheDocument();
  expect(screen.getByText('PREVIEW — NOT APPLIED')).toBeInTheDocument();
  expect(screen.getAllByText(/method locked/i)).toHaveLength(2);
});

it('disables apply until recompute has run, then enables once reason is filled', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  expect(screen.queryByText('Apply to live mapping')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  expect(applyBtn).toBeDisabled();

  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });
  expect(applyBtn).not.toBeDisabled();
});

it('applies coa mapping with reason + actor and shows the applied badge', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });
  fireEvent.change(screen.getByLabelText('remap actor'), { target: { value: 'ops' } });
  fireEvent.click(applyBtn);

  await waitFor(() => expect(applyCoaMapping).toHaveBeenCalledWith(
    [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' }],
    'fix mapping',
    'ops',
  ));
  await waitFor(() => expect(screen.getByText(/Applied — mapping v3 \(rule r\)/)).toBeInTheDocument());
});

it('renders apply failure message inline', async () => {
  applyCoaMapping.mockRejectedValueOnce(new Error('409 NO_CHANGE'));
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });
  fireEvent.click(applyBtn);

  await waitFor(() => expect(screen.getByText('409 NO_CHANGE')).toBeInTheDocument());
});

it('renders PolicyEditForm with disabled currency inputs', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  const functionalCurrency = screen.getByLabelText('functional currency (locked)') as HTMLInputElement;
  const reportingCurrency = screen.getByLabelText('reporting currency (locked)') as HTMLInputElement;
  expect(functionalCurrency).toBeDisabled();
  expect(functionalCurrency.title).toMatch(/USD-locked in MVP/);
  expect(reportingCurrency).toBeDisabled();
});

it('renders policy history changes from getPolicyHistory', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getByText(/initial setup/)).toBeInTheDocument());
});
