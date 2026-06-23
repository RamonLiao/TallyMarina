import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  it('renders a material break with a blocking marker, signed break value, and direction label', () => {
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={() => {}} />);
    // Material row must exist — WHY: material breaks require user action before close
    const materialEl = screen.getByLabelText(/material break/i);
    expect(materialEl).toBeInTheDocument();
    // Break must be SIGNED positive — WHY: unsigned breaks are ambiguous direction
    const breakRow = materialEl.closest('tr')!;
    expect(within(breakRow).getByText(/\+1\.202000000/)).toBeInTheDocument();
    // Direction label tells accountant which side dominates — WHY: sign alone isn't enough
    expect(within(breakRow).getByText(/book over statement/i)).toBeInTheDocument();
  });

  it('non-SUI chain provenance renders em-dash (n/a), not live', () => {
    render(<ReconTable rows={[row({ coinType: '0xusdc::usdc::USDC', provenance: { computed: 'book', statement: 'mock', chain: 'n/a' } })]} selectedKey={null} onSelect={() => {}} />);
    // WHY: non-SUI assets have no on-chain balance; must never show "live"
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('chain=unavailable renders warn treatment and NOT the live marker', () => {
    render(<ReconTable rows={[row({ provenance: { computed: 'book', statement: 'mock', chain: 'unavailable' } })]} selectedKey={null} onSelect={() => {}} />);
    // WHY: fail-loud — a read failure must never be silently treated as "live"
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it('row click fires onSelect with composite key', () => {
    const onSelect = vi.fn();
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('SUI'));
    expect(onSelect).toHaveBeenCalledWith('0xacmeTreasury|0x2::sui::SUI');
  });

  it('negative break renders U+2212 minus sign', () => {
    render(<ReconTable rows={[row({ breakMinor: '-500000000', computedMinor: '3298000000', statementMinor: '3798000000' })]} selectedKey={null} onSelect={() => {}} />);
    // WHY: U+2212 (−) not hyphen-minus (-) for typographic correctness; negative = statement-over-book
    const breakEl = screen.getByLabelText(/material break/i);
    // text contains the minus char U+2212
    expect(breakEl.textContent).toMatch(/−/);
    // must NOT have a leading +
    expect(breakEl.textContent).not.toMatch(/^\+/);
  });
});
