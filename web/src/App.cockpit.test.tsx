// WHY: the close landing is now the cockpit, not the linear step flow;
// StepRail is secondary. This test proves CloseCockpit renders as the primary
// landing when activeWorkspace === 'close' (the default).
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AppProviders } from './providers/AppProviders';
import App from './App';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

// Mock useCloseCockpit so no real fetch is issued; returns a minimal cockpit payload.
vi.mock('./data/useCloseCockpit', () => ({
  useCloseCockpit: () => ({
    data: {
      entityId: 'test-entity',
      period: '2024-Q1',
      status: 'OPEN',
      closeable: true,
      lights: [],
      reopenCount: 0,
      staleAnchor: false,
    },
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

function renderApp() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  );
}

it('close workspace renders the cockpit verdict as the primary landing', () => {
  // WorkspaceProvider starts with activeWorkspace='close' (the default).
  renderApp();
  // CloseCockpit renders a <p role="status" aria-live="polite"> with the verdict.
  expect(screen.getByRole('status')).toBeInTheDocument();
});
