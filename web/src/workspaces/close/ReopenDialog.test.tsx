// web/src/workspaces/close/ReopenDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReopenDialog } from './ReopenDialog';

describe('ReopenDialog', () => {
  it('shows mock-until-auth ribbon at top and gates step 2 on reason', () => {
    render(<ReopenDialog entityId="e1" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/mock-until-auth/i)).toBeInTheDocument();
    // WHY: SoD ritual must FEEL gated even while mocked — approve disabled until reason typed.
    expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
  });

  it('renders optional affected amount estimate input', () => {
    render(<ReopenDialog entityId="e1" onChanged={vi.fn()} onClose={vi.fn()} />);
    // WHY: affectedAmountEstimate is an ASC 250/IAS 8 audit-nice-to-have; must be present in the UI
    //      so reviewers can supply the restatement magnitude without a separate out-of-band step.
    expect(screen.getByPlaceholderText(/minor units/i)).toBeInTheDocument();
  });

  it('typing amount does not affect approve-gating (amount is optional)', async () => {
    render(<ReopenDialog entityId="e1" onChanged={vi.fn()} onClose={vi.fn()} />);
    const amountInput = screen.getByPlaceholderText(/minor units/i);
    await userEvent.type(amountInput, '150000');
    // WHY: optional field must never gate the SoD ritual — approve still disabled without reason.
    expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
  });
});
