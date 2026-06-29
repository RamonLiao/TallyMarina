import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from './providers/AppProviders';
import App from './App';
import { WORKSPACES } from './app/workspaces';

// Mock ConnectButton — needs DAppKitProvider context; prevents unhandled rejection
vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

function renderApp() {
  return render(
    <AppProviders>
      <MemoryRouter>
        <App />
      </MemoryRouter>
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

it('export workspace is status ready in registry (not soon)', () => {
  const exportEntry = WORKSPACES.find((w) => w.id === 'export');
  expect(exportEntry).toBeDefined();
  expect(exportEntry?.status).toBe('ready');
});

it('selecting Export workspace mounts ExportWorkspace and does not show generic EmptyState coming-soon', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Export/ }));
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  // ExportWorkspace renders an <h1>Export</h1> heading — confirms the real component mounted.
  expect(screen.getByRole('heading', { name: /^Export$/i })).toBeInTheDocument();
});
