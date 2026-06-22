import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Header } from './Header';

// Mock ConnectButton — it needs DAppKitProvider context; we test rendering only
vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

it('renders TallyMarina wordmark in the header', () => {
  render(<Header />);
  expect(screen.getByText('TallyMarina')).toBeInTheDocument();
});

it('renders the ConnectButton in the header', () => {
  render(<Header />);
  expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument();
});

it('renders the mascot (sailing otter) in the header', () => {
  render(<Header />);
  expect(screen.getByRole('img', { name: /otter sailing/i })).toBeInTheDocument();
});

it('has a header landmark', () => {
  render(<Header />);
  expect(screen.getByRole('banner')).toBeInTheDocument();
});
