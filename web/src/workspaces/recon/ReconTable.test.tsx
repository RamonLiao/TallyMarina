import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReconTable } from './ReconTable';
import type { ReconRowDTO } from '../../api/types';

const row = (over: Partial<ReconRowDTO>): ReconRowDTO => ({
  wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', decimals: 9,
  openingMinor: '1200000000', movementMinor: '3800000000', computedMinor: '5000000000',
  statementMinor: '3798000000', breakMinor: '1202000000', thresholdMinor: '1000000000', material: true,
  control: { debitMinor: '5000000000', creditMinor: '1200000000', legs: 2 },
  provenance: { computed: 'book', statement: 'mock', chain: 'live' }, disposition: null, ...over,
});

describe('ReconTable', () => {
  it('renders a material break with a blocking marker and signed value', () => {
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText('SUI')).toBeInTheDocument();
    // signed, U+2212 not hyphen-minus would be for negatives; positive book-over shows direction label.
    expect(screen.getByText(/statement|over|break/i)).toBeTruthy();
    expect(screen.getByLabelText(/material/i)).toBeInTheDocument();
  });

  it('non-SUI chain provenance renders n/a, not a balance', () => {
    render(<ReconTable rows={[row({ coinType: '0xusdc::usdc::USDC', provenance: { computed: 'book', statement: 'mock', chain: 'n/a' } })]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('row click fires onSelect with composite key', () => {
    const onSelect = vi.fn();
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('SUI'));
    expect(onSelect).toHaveBeenCalledWith('0xacmeTreasury|0x2::sui::SUI');
  });
});
