// web/src/workspaces/close/ReopenDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReopenDialog } from './ReopenDialog';

describe('ReopenDialog', () => {
  it('shows mock-until-auth ribbon at top and gates step 2 on reason', () => {
    render(<ReopenDialog entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/mock-until-auth/i)).toBeInTheDocument();
    // WHY: SoD ritual must FEEL gated even while mocked — approve disabled until reason typed.
    expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
  });

  it('renders optional affected amount estimate input', () => {
    render(<ReopenDialog entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} onClose={vi.fn()} />);
    // WHY: affectedAmountEstimate is an ASC 250/IAS 8 audit-nice-to-have; must be present in the UI
    //      so reviewers can supply the restatement magnitude without a separate out-of-band step.
    expect(screen.getByPlaceholderText(/minor units/i)).toBeInTheDocument();
  });

  it('typing amount does not affect approve-gating (amount is optional)', async () => {
    render(<ReopenDialog entityId="e1" periodId="2026-Q2" onChanged={vi.fn()} onClose={vi.fn()} />);
    const amountInput = screen.getByPlaceholderText(/minor units/i);
    await userEvent.type(amountInput, '150000');
    // WHY: optional field must never gate the SoD ritual — approve still disabled without reason.
    expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
  });

  it('POSTs the periodId being reopened', async () => {
    // WHY: /period/reopen still falls back to the server's DEFAULT_PERIOD when periodId is
    // absent. Omitting it means an operator reopening 2026-Q3 silently reopens 2026-Q2 —
    // an anchored period unlocked without anyone asking for it.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<ReopenDialog entityId="e1" periodId="2026-Q3" onChanged={onChanged} onClose={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/restatement reason/i), 'misposted lot');
    await userEvent.click(screen.getByRole('button', { name: /request reopen/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve & reopen/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { periodId: string };
    expect(body.periodId).toBe('2026-Q3');
    vi.unstubAllGlobals();
  });
});
