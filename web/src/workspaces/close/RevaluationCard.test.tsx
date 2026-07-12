// web/src/workspaces/close/RevaluationCard.test.tsx — endpoints mocked, real useRevaluation hook.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RevaluationCard } from './RevaluationCard';
import { ApiClientError } from '../../api/client';
import * as endpoints from '../../api/endpoints';
import type { RevaluationPreviewDTO, PricePointDTO, EntityAssetDTO } from '../../api/types';

vi.mock('../../api/endpoints', () => ({
  getRevaluationPreview: vi.fn(),
  postRevaluationRun: vi.fn(),
  getPrices: vi.fn(),
  postPrice: vi.fn(),
  getAssets: vi.fn(),
}));

// Registry rows arrive in the CANONICAL long address form while preview rows use the short
// form (0x2::sui::SUI) — the card must match them anyway (found live in the Task 12
// Playwright gate: qty rendered raw minor units because the exact-string lookup missed).
const ASSETS: EntityAssetDTO[] = [
  { coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI', decimals: 9, symbol: 'SUI', source: 'chain' },
  { coinType: '0x000000000000000000000000000000000000000000000000000000000000beef::usdc::USDC', decimals: 6, symbol: 'USDC', source: 'manual' },
];

function makePreview(over: Partial<RevaluationPreviewDTO> = {}): RevaluationPreviewDTO {
  return {
    rows: [
      {
        coinType: '0x2::sui::SUI',
        basis: 'GAAP_FV',
        priorCarryingMinor: '500000',
        currentValueMinor: '650000',
        deltaMinor: '150000',
        missingPrice: false,
        lots: [
          { lotId: 'lot-1', qtyMinor: '2000000000', priorCarryingMinor: '500000', currentValueMinor: '650000', deltaMinor: '150000' },
        ],
      },
    ],
    journalDraft: [],
    priceMissing: [],
    ...over,
  };
}

const PRICE_ROW: PricePointDTO = {
  id: 'px-1', entityId: 'acme:pilot-001', coinType: '0x2::sui::SUI', asOf: '2026-06-30',
  priceMinor: '325', quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual',
  level: 'LEVEL_2', createdAt: '2026-06-30T00:00:00Z', superseded: false,
};

const onCockpitRefetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endpoints.getAssets).mockResolvedValue(ASSETS);
  vi.mocked(endpoints.getPrices).mockResolvedValue([PRICE_ROW]);
  vi.mocked(endpoints.getRevaluationPreview).mockResolvedValue(makePreview());
});

function mount() {
  return render(
    <RevaluationCard entityId="acme:pilot-001" periodId="2026-Q2" periodStatus="OPEN" onCockpitRefetch={onCockpitRefetch} />,
  );
}

describe('RevaluationCard', () => {
  it('missing price disables Run with the reason in title, and shows the blockers chip', async () => {
    vi.mocked(endpoints.getRevaluationPreview).mockResolvedValue(makePreview({
      rows: [{
        coinType: '0xbeef::usdc::USDC', basis: 'GAAP_FV',
        priorCarryingMinor: '100000', currentValueMinor: '0', deltaMinor: '0',
        missingPrice: true, lots: [],
      }],
      priceMissing: ['0xbeef::usdc::USDC'],
    }));
    mount();
    const run = await screen.findByRole('button', { name: /run revaluation/i });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('title', expect.stringMatching(/missing price/i));
    // Top-level double warning: the .lock-blockers chip counts the missing assets.
    expect(screen.getByText(/1 asset missing price/i)).toBeInTheDocument();
  });

  it('renders the preview table with per-asset rows and expands per-lot detail', async () => {
    mount();
    // Aggregate row: symbol + basis chip + fiat-formatted (decimals=2) amounts.
    expect(await screen.findByText('SUI')).toBeInTheDocument();
    expect(screen.getByText(/ASU 2023-08/i)).toBeInTheDocument();
    expect(screen.getByText('6,500.00')).toBeInTheDocument();
    // Lots hidden until expanded.
    expect(screen.queryByText(/lot-1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /lots for SUI/i }));
    expect(await screen.findByText(/lot-1/)).toBeInTheDocument();
    // qty formatted at the asset's registry scale (9 decimals).
    expect(screen.getByText(/2\.000000000/)).toBeInTheDocument();
  });

  it('run success shows the applied badge and refetches the cockpit', async () => {
    vi.mocked(endpoints.postRevaluationRun).mockResolvedValue({ runId: 'run-1', jeIds: ['je-1'], reversedRunId: null });
    mount();
    const run = await screen.findByRole('button', { name: /run revaluation/i });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    const badge = await screen.findByText(/revaluation posted/i);
    expect(badge).toHaveClass('policy-applied-badge');
    expect(onCockpitRefetch).toHaveBeenCalled();
  });

  it('409 REVAL_ALREADY_CURRENT renders a neutral badge, not the red error style', async () => {
    vi.mocked(endpoints.postRevaluationRun).mockRejectedValue(
      new ApiClientError('REVAL_ALREADY_CURRENT', 'valuation already current', 409),
    );
    mount();
    const run = await screen.findByRole('button', { name: /run revaluation/i });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    const notice = await screen.findByText(/already current — no changes/i);
    expect(notice).toHaveClass('policy-applied-badge');
    expect(notice).not.toHaveClass('policy-bad');
  });

  it('other run errors render red via .policy-bad', async () => {
    vi.mocked(endpoints.postRevaluationRun).mockRejectedValue(
      new ApiClientError('PRICE_MISSING', 'no price for 0x2::sui::SUI', 400),
    );
    mount();
    const run = await screen.findByRole('button', { name: /run revaluation/i });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    const err = await screen.findByText(/no price for/i);
    expect(err).toHaveClass('policy-bad');
  });

  it('price save posts the decimal STRING, shows Price saved, and refetches cockpit + preview', async () => {
    vi.mocked(endpoints.postPrice).mockResolvedValue({ ...PRICE_ROW, id: 'px-2' });
    mount();
    await screen.findByText('SUI');
    const previewCalls = vi.mocked(endpoints.getRevaluationPreview).mock.calls.length;
    fireEvent.change(screen.getByLabelText(/price \(USD\)/i), { target: { value: '3.25' } });
    fireEvent.click(screen.getByRole('button', { name: /save price/i }));
    expect(await screen.findByText(/price saved/i)).toBeInTheDocument();
    // The dropdown posts the registry's canonical coinType as-is; price stays a decimal string.
    expect(endpoints.postPrice).toHaveBeenCalledWith('acme:pilot-001', {
      coinType: ASSETS[0]!.coinType, asOf: '2026-06-30', price: '3.25',
    });
    expect(onCockpitRefetch).toHaveBeenCalled();
    // Preview recomputed so the trial table reflects the new price immediately.
    await waitFor(() =>
      expect(vi.mocked(endpoints.getRevaluationPreview).mock.calls.length).toBeGreaterThan(previewCalls));
  });

  it('rejects a malformed price client-side with a specific .policy-bad message', async () => {
    mount();
    await screen.findByText('SUI');
    fireEvent.change(screen.getByLabelText(/price \(USD\)/i), { target: { value: '3.14159' } });
    fireEvent.click(screen.getByRole('button', { name: /save price/i }));
    const msg = await screen.findByText(/at most 2 decimal places/i);
    expect(msg).toHaveClass('policy-bad');
    expect(endpoints.postPrice).not.toHaveBeenCalled();
  });

  it('LOCKED period disables Run with the reason in title', async () => {
    render(
      <RevaluationCard entityId="acme:pilot-001" periodId="2026-Q2" periodStatus="LOCKED" onCockpitRefetch={onCockpitRefetch} />,
    );
    const run = await screen.findByRole('button', { name: /run revaluation/i });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('title', expect.stringMatching(/locked/i));
  });

  it('price history renders newest first with a superseded marker', async () => {
    vi.mocked(endpoints.getPrices).mockResolvedValue([
      { ...PRICE_ROW, id: 'px-old', priceMinor: '300', createdAt: '2026-06-29T00:00:00Z', superseded: true },
      { ...PRICE_ROW, id: 'px-new', priceMinor: '325', createdAt: '2026-06-30T12:00:00Z', superseded: false },
    ]);
    mount();
    const rows = await screen.findAllByRole('listitem');
    // Newest (3.25) on top; older row carries the superseded chip.
    expect(rows[0]).toHaveTextContent('3.25');
    expect(rows[1]).toHaveTextContent(/superseded/i);
    expect(rows[0]).not.toHaveTextContent(/superseded/i);
  });
});
