import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from '../providers/AppProviders';
import App from '../App';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

// All real workspaces are now 'ready'. Inject a synthetic 'soon-test' workspace so
// the EmptyState gating test remains live without depending on live registry state.
// WorkspaceContent routes by id (not status); 'soon-test' has no explicit branch,
// so it falls through to the EmptyState "coming soon" render.
vi.mock('../app/workspaces', () => ({
  WORKSPACES: [
    { id: 'close',          label: 'Close',          icon: '⚓', status: 'ready' },
    { id: 'exceptions',     label: 'Exceptions',     icon: '⚠', status: 'ready' },
    { id: 'reconciliation', label: 'Reconciliation', icon: '⚖', status: 'ready' },
    { id: 'audit',          label: 'Audit',          icon: '🔍', status: 'ready' },
    { id: 'policy',         label: 'Policy',         icon: '📐', status: 'ready' },
    { id: 'export',         label: 'Export',         icon: '📤', status: 'ready' },
    { id: 'onboarding',     label: 'Onboarding',     icon: '🚢', status: 'ready' },
    { id: 'soon-test',      label: 'SoonTest',       icon: '🚧', status: 'soon' },
  ],
  isWorkspaceId: (v: string) =>
    ['close','exceptions','reconciliation','audit','policy','export','onboarding','soon-test'].includes(v),
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
  // The test injects a synthetic 'soon-test' workspace; all real workspaces are now 'ready'.
  // 'soon-test' has no branch in WorkspaceContent so it falls through to EmptyState.
  await userEvent.click(screen.getByRole('button', { name: /SoonTest/ }));
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
  // GuardrailBanner is a role="note" element; scope the assertion to it (not any /AI/ text
  // on the page) so this proves the banner itself persists, not an incidental match.
  const banner = screen.getByRole('note', { name: /no posting authority/i });
  expect(banner).toHaveTextContent(/AI suggestions only/i);
});

it('rapid workspace switching leaves no stale content', async () => {
  renderApp();
  for (const name of [/Exceptions/, /Export/, /Onboarding/, /Close/]) {
    await userEvent.click(screen.getByRole('button', { name }));
  }
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});
