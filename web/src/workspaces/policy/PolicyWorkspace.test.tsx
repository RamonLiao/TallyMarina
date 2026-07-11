import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import { PolicyWorkspace } from './PolicyWorkspace';
import type { JournalDTO, EventDTO } from '../../api/types';

const applyCoaMapping = vi.fn().mockResolvedValue(undefined);
const applyPolicyChanges = vi.fn().mockResolvedValue(undefined);
const refetch = vi.fn();

// Mutable per-test overrides for journal/events, read by baseData() below. Reset in afterEach
// so tests that don't set them keep seeing the original empty-journal baseline.
let journalOverride: JournalDTO[] = [];
let eventsOverride: EventDTO[] = [];

afterEach(() => {
  journalOverride = [];
  eventsOverride = [];
});

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
    journal: journalOverride, events: eventsOverride,
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

// ---- Apply-safety guard coverage (house rule: every guard must have gone red once) ----

const line = (account: string, side: 'DEBIT' | 'CREDIT', amountMinor: string, leg: string) => ({
  account, side, amountMinor, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg,
});

const eventDigitalAssetReceipt: EventDTO = {
  id: 'ev1', entityId: 'acme:pilot-001', status: 'POSTED', normalized: {},
  ai: null, final: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: 'x' }, routing: null,
};

// One unmatched DEBIT leg only: journal itself is unbalanced (100 debit / 0 credit), so
// conservation.balanced is false before any remap even happens.
const journalImbalanced: JournalDTO[] = [{
  id: 'je1', eventId: 'ev1', idempotencyKey: 'idem1', leafHash: 'h1',
  je: { idempotencyKey: 'idem1', lineageHash: 'lh1', reversalOf: null, lines: [line('DigitalAssets', 'DEBIT', '100', 'L1')] },
}];

// Balanced DEBIT/CREDIT pair: L1 hits the existing rule (DigitalAssets), L2 falls through to
// the default account (Suspense). Both accounts are already in knownAccounts, so a plain
// recompute produces zero warnings and balanced=true.
const journalBalanced: JournalDTO[] = [{
  id: 'je1', eventId: 'ev1', idempotencyKey: 'idem1', leafHash: 'h1',
  je: {
    idempotencyKey: 'idem1', lineageHash: 'lh1', reversalOf: null,
    lines: [line('DigitalAssets', 'DEBIT', '100', 'L1'), line('Suspense', 'CREDIT', '100', 'L2')],
  },
}];

it('conservation.balanced === false disables Apply; ORPHANED_BALANCE alone does not', async () => {
  journalOverride = journalImbalanced;
  eventsOverride = [eventDigitalAssetReceipt];
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });

  expect(screen.getByText('CONSERVATION BROKEN')).toBeInTheDocument();
  expect(applyBtn).toBeDisabled();
  expect(applyBtn.title).toMatch(/Conservation broken/);
});

it('ORPHANED_BALANCE warning alone (non-blocking) does not disable Apply', async () => {
  journalOverride = journalBalanced;
  eventsOverride = [eventDigitalAssetReceipt];
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  // Remap L1's account onto the default Suspense account too: DigitalAssets then has no
  // after-activity (orphaned), while both legs still net to a balanced Suspense debit/credit.
  fireEvent.change(screen.getByLabelText('account for DIGITAL_ASSET_RECEIPT L1'), { target: { value: 'Suspense' } });
  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });

  expect(screen.getByText(/ORPHANED_BALANCE/)).toBeInTheDocument();
  expect(screen.getByText('Grand totals conserved ✓')).toBeInTheDocument();
  expect(applyBtn).not.toBeDisabled();
});

it('UNKNOWN_ACCOUNT warning disables Apply', async () => {
  journalOverride = journalBalanced;
  eventsOverride = [eventDigitalAssetReceipt];
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  // Remap L1's account to one not present in knownAccounts (not a rule account, not the
  // default, not a journal-line account) to trigger UNKNOWN_ACCOUNT specifically.
  fireEvent.change(screen.getByLabelText('account for DIGITAL_ASSET_RECEIPT L1'), { target: { value: 'GhostAccount' } });
  fireEvent.click(screen.getByText('Recompute preview'));
  const applyBtn = await screen.findByText('Apply to live mapping');
  fireEvent.change(screen.getByLabelText('remap reason'), { target: { value: 'fix mapping' } });

  expect(screen.getByText(/UNKNOWN_ACCOUNT/)).toBeInTheDocument();
  expect(applyBtn).toBeDisabled();
  expect(applyBtn.title).toMatch(/UNKNOWN_ACCOUNT\/EMPTY_ACCOUNT/);
});

it('PolicyEditForm Apply calls applyPolicyChanges(changes, reason, actor) on the happy path', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getAllByText('demo-ps-1').length).toBeGreaterThan(0));

  fireEvent.change(screen.getByLabelText('accounting standard'), { target: { value: 'IFRS' } });
  fireEvent.change(screen.getByLabelText('policy change reason'), { target: { value: 'switch to IFRS' } });
  fireEvent.change(screen.getByLabelText('policy change actor'), { target: { value: 'ops' } });
  fireEvent.click(screen.getByText('Apply policy changes'));

  await waitFor(() => expect(applyPolicyChanges).toHaveBeenCalledWith(
    {
      accountingStandard: 'IFRS',
      costBasisMethod: 'FIFO',
      stablecoinTreatment: 'CASH_EQUIVALENT',
      stakingIncomePolicy: 'OPERATING_REVENUE',
      feeExpensePolicy: 'EXPENSE_IMMEDIATE',
      revaluationPolicy: 'cost',
    },
    'switch to IFRS',
    'ops',
  ));
});
