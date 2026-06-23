import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from './providers/AppProviders';
import App from './App';

// Mock ConnectButton — needs DAppKitProvider context; prevents unhandled rejection
vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

function renderApp() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  );
}

it('renders the app shell inside the provider tree without throwing', () => {
  renderApp();
  expect(screen.getByLabelText('TallyMarina')).toBeInTheDocument();
});

it('renders the Audit workspace when the audit nav item is selected', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
});
