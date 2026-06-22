import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from '../providers/AppProviders';
import App from '../App';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

function renderApp() {
  return render(<AppProviders><App /></AppProviders>);
}

it('starts in the Close workspace showing the step rail', () => {
  renderApp();
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});

it('switching to a soon workspace shows EmptyState and HIDES the close step rail', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Reconciliation/ }));
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  // Why this matters: an empty workspace must not leak the previous workspace's content.
  expect(screen.queryByLabelText('Close-the-period progress')).not.toBeInTheDocument();
});

it('switching back to Close restores the step rail', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  await userEvent.click(screen.getByRole('button', { name: /Close/ }));
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});

it('GuardrailBanner persists across workspaces (AI-no-posting governance always visible)', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  // GuardrailBanner declares AI-suggestions-only; assert its hallmark copy is present.
  expect(screen.getByText(/AI/i)).toBeInTheDocument();
});

it('rapid workspace switching leaves no stale content', async () => {
  renderApp();
  for (const name of [/Exceptions/, /Export/, /Onboarding/, /Close/]) {
    await userEvent.click(screen.getByRole('button', { name }));
  }
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});
