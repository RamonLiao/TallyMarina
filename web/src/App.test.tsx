import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AppProviders } from './providers/AppProviders';
import App from './App';

// Mock ConnectButton — needs DAppKitProvider context; prevents unhandled rejection
vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

it('renders the app shell inside the provider tree without throwing', () => {
  render(
    <AppProviders>
      <App />
    </AppProviders>
  );
  expect(screen.getByLabelText('TallyMarina')).toBeInTheDocument();
});
