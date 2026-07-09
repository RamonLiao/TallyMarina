import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { EntityProvider } from '../../app/EntityContext';
import { WorkspaceProvider } from '../../app/WorkspaceContext';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));
vi.mock('../../api/hooks', () => ({
  useEntities: () => ({
    data: [
      { id: 'acme', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
    ],
    isLoading: false,
  }),
}));

import { TopBar } from './TopBar';

function renderTopBar() {
  return render(
    <MemoryRouter>
      <EntityProvider>
        <WorkspaceProvider><TopBar /></WorkspaceProvider>
      </EntityProvider>
    </MemoryRouter>,
  );
}

it('renders the brand name and the connect button', () => {
  renderTopBar();
  expect(screen.getByText('TallyMarina')).toBeInTheDocument();
  expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
});

it('renders an entity selector populated from useEntities', () => {
  renderTopBar();
  const select = screen.getByLabelText('Entity') as HTMLSelectElement;
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Acme Pilot' })).toBeInTheDocument();
});

it('shows the read-only period pill', () => {
  renderTopBar();
  expect(screen.getByText('2026-Q2')).toBeInTheDocument();
});

it('keeps the wallet inside a .wallet-slot stacking context', () => {
  const { container } = renderTopBar();
  expect(container.querySelector('.wallet-slot')).not.toBeNull();
});

it('exposes a workspaces menu toggle for narrow viewports', () => {
  renderTopBar();
  expect(screen.getByRole('button', { name: /open workspaces menu/i })).toBeInTheDocument();
});

it('still renders the desktop wallet slot in the header', () => {
  // WHY: the wallet is hidden on mobile by CSS, not unmounted. jsdom applies
  // no media queries, so this asserts the element survives — the 390px
  // browser pass (Task 6) is what proves it is actually hidden.
  const { container } = renderTopBar();
  expect(container.querySelector('.topbar-wallet')).not.toBeNull();
});
