// web/src/workspaces/close/ReopenDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReopenDialog } from './ReopenDialog';

describe('ReopenDialog', () => {
  it('shows mock-until-auth ribbon at top and gates step 2 on reason', () => {
    render(<ReopenDialog entityId="e1" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/mock-until-auth/i)).toBeInTheDocument();
    // WHY: SoD ritual must FEEL gated even while mocked — approve disabled until reason typed.
    expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
  });
});
