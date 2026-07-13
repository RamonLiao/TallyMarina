import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportsWorkspace } from './ReportsWorkspace';
import type { TrialBalanceResponseDTO, RollForwardResponseDTO } from '../../api/types';

// Mock hooks so we control TB/RF payloads without network (pattern: AuditWorkspace.test.tsx).
const mockTrialBalance = vi.fn();
const mockRollForward = vi.fn();
vi.mock('../../api/hooks', () => ({
  useTrialBalance: () => mockTrialBalance(),
  useRollForward: () => mockRollForward(),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const meta = {
  accountingStandard: 'US_GAAP',
  policySetVersion: 'v7',
  periodStatus: 'OPEN',
  generatedAt: '2026-07-13T00:00:00.000Z',
};

function tb(overrides: Partial<TrialBalanceResponseDTO> = {}): TrialBalanceResponseDTO {
  return {
    rows: [
      { account: 'Cash', accountClass: 'asset', openingMinor: '100000', debitMinor: '50000', creditMinor: '20000', closingMinor: '130000' },
    ],
    tieOut: { sumDebitMinor: '50000', sumCreditMinor: '50000', sumSignedClosingMinor: '0', balanced: true, failures: [] },
    meta,
    drift: null,
    ...overrides,
  };
}

function rf(overrides: Partial<RollForwardResponseDTO> = {}): RollForwardResponseDTO {
  return {
    notApplicable: false,
    reason: null,
    rows: [
      {
        coinType: '0x2::sui::SUI', openingFvMinor: '100', additionsMinor: '50', disposalsMinor: '10',
        gainsMinor: '5', lossesMinor: '0', closingFvMinor: '145', identityOk: true,
      },
    ],
    tbTie: { digitalAssetsClosingMinor: '145', closingFvTotalMinor: '145', ok: true },
    identitiesOk: true,
    meta,
    ...overrides,
  };
}

beforeEach(() => {
  mockTrialBalance.mockReset();
  mockRollForward.mockReset();
});

it('renders TB opening/Dr/Cr/closing via fmtMinor(…,2), right-aligned tabular-nums', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  // fmtMinor('100000', 2) => "1,000.00" etc — exact formatted strings must appear.
  expect(screen.getByText('1,000.00')).toBeInTheDocument(); // opening
  expect(screen.getByText('500.00')).toBeInTheDocument();   // debit
  expect(screen.getByText('200.00')).toBeInTheDocument();   // credit
  expect(screen.getByText('1,300.00')).toBeInTheDocument(); // closing

  const closingCell = screen.getByText('1,300.00');
  expect(closingCell.closest('td, span')).toBeTruthy();
  const styled = closingCell.closest('[style]') as HTMLElement | null;
  expect(styled).toBeTruthy();
  expect(styled!.style.textAlign).toBe('right');
  expect(styled!.style.fontVariantNumeric).toBe('tabular-nums');
});

it('tie-out banner shows failures when balanced=false', () => {
  mockTrialBalance.mockReturnValue({
    data: tb({ tieOut: { sumDebitMinor: '50000', sumCreditMinor: '40000', sumSignedClosingMinor: '10000', balanced: false, failures: ['unknown account class: Mystery', 'period activity imbalance: Dr 50000 != Cr 40000'] } }),
    isLoading: false,
  });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  expect(screen.getByText(/unknown account class: Mystery/)).toBeInTheDocument();
  expect(screen.getByText(/period activity imbalance: Dr 50000 != Cr 40000/)).toBeInTheDocument();
  expect(screen.getByText(/FAIL/i)).toBeInTheDocument();
});

it('tie-out banner shows PASS styling when balanced=true', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  expect(screen.getAllByText(/PASS/).length).toBeGreaterThan(0);
});

it('meta row shows standard + policySetVersion + periodStatus', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  expect(screen.getByText(/US_GAAP/)).toBeInTheDocument();
  expect(screen.getByText(/v7/)).toBeInTheDocument();
  expect(screen.getByText(/OPEN/)).toBeInTheDocument();
});

it('drift warning: non-null drift renders a blocked/danger alert, never aqua', () => {
  mockTrialBalance.mockReturnValue({
    data: tb({ drift: { code: 'LIGHTS_SNAPSHOT_DRIFT', frozenJeStatus: 'green', recomputedBalanced: false } }),
    isLoading: false,
  });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  const alert = screen.getByRole('alert');
  expect(alert).toBeInTheDocument();
  expect(alert.textContent).toMatch(/drift/i);
  // aqua is on-chain/anchor semantics only — a drift alert must never carry the aqua class.
  expect(alert.className).not.toMatch(/aqua/i);
});

it('roll-forward renders both identities as PASS/FAIL rows', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({
    data: rf({
      rows: [{ coinType: '0x2::sui::SUI', openingFvMinor: '100', additionsMinor: '50', disposalsMinor: '10', gainsMinor: '5', lossesMinor: '0', closingFvMinor: '145', identityOk: false }],
      tbTie: { digitalAssetsClosingMinor: '999', closingFvTotalMinor: '145', ok: false },
      identitiesOk: false,
    }),
    isLoading: false,
  });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  // Identity ① (per-coin) and Identity ② (TB tie) each render their own PASS/FAIL text.
  expect(screen.getAllByText(/FAIL/i).length).toBeGreaterThanOrEqual(2);
});

it('roll-forward shows N/A explanation for IFRS with text + icon (non-colour cue)', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({
    data: rf({ notApplicable: true, reason: 'IFRS', rows: [], tbTie: null, identitiesOk: true }),
    isLoading: false,
  });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  expect(screen.getByText(/N\/A/)).toBeInTheDocument();
  expect(screen.getByText(/IFRS/)).toBeInTheDocument();
  // Non-colour cue: an icon/glyph accompanies the text, not colour alone.
  expect(screen.getByText(/ℹ/)).toBeInTheDocument();
});

it('unknown-class row renders — with a ? superscript, never a default 0', () => {
  mockTrialBalance.mockReturnValue({
    data: tb({
      rows: [{ account: 'Mystery', accountClass: null, openingMinor: '100', debitMinor: '500', creditMinor: '300', closingMinor: null }],
      tieOut: { sumDebitMinor: '0', sumCreditMinor: '0', sumSignedClosingMinor: '0', balanced: false, failures: ['unknown account class: Mystery'] },
    }),
    isLoading: false,
  });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  const tbTable = screen.getByRole('table', { name: 'Trial balance' });
  const dash = within(tbTable).getByText('—');
  expect(dash).toBeInTheDocument();
  const sup = dash.parentElement?.querySelector('sup');
  expect(sup).toBeTruthy();
  expect(sup?.textContent).toBe('?');
  // Must never silently render "0.00" for the unknown-class closing cell (scoped to the TB
  // table — the roll-forward table legitimately has zero-valued cells elsewhere).
  expect(within(tbTable).queryByText('0.00')).not.toBeInTheDocument();
});

it('renders an explicit empty state when the period has no TB rows', () => {
  mockTrialBalance.mockReturnValue({ data: tb({ rows: [], tieOut: { sumDebitMinor: '0', sumCreditMinor: '0', sumSignedClosingMinor: '0', balanced: true, failures: [] } }), isLoading: false });
  mockRollForward.mockReturnValue({ data: rf({ rows: [] }), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2099-Q4" />);

  expect(screen.getByText(/no.*data/i)).toBeInTheDocument();
});

it('renders NO otter mascot on the reports data-surface (§8.4)', () => {
  mockTrialBalance.mockReturnValue({ data: tb(), isLoading: false });
  mockRollForward.mockReturnValue({ data: rf(), isLoading: false });
  wrap(<ReportsWorkspace entityId="e1" periodId="2026-Q2" />);

  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});
