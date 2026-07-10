import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReconTable } from './ReconTable';
import type { ReconRowDTO } from '../../api/types';

const suiType = '0x2::sui::SUI';

const row = (over: Partial<ReconRowDTO>): ReconRowDTO => ({
  wallet: '0xacmeTreasury', coinType: suiType, decimals: 9,
  openingMinor: '1200000000', movementMinor: '3800000000', computedMinor: '5000000000',
  statementMinor: '3798000000', breakMinor: '1202000000', thresholdMinor: '1000000000', material: true,
  control: { debitMinor: '5000000000', creditMinor: '1200000000', legs: 2 },
  provenance: { computed: 'book', statement: 'mock', chain: 'live' }, disposition: null, ...over,
});

const key = (r: ReconRowDTO) => `${r.wallet}|${r.coinType}`;

describe('ReconTable', () => {
  it('renders a material break with a blocking marker, signed break value, and direction label', () => {
    // clientMovements matches DTO → no drift; clientComputed = 1200000000+3800000000=5000000000
    // clientBreak = 5000000000 − 3798000000 = 1202000000 → +1.202000000
    const r = row({});
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{ [key(r)]: 3800000000n }} />);
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
    render(<ReconTable rows={[row({ coinType: '0xbeef::usdc::USDC', provenance: { computed: 'book', statement: 'mock', chain: 'n/a' } })]} selectedKey={null} onSelect={() => {}} />);
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
    // opening=3800000000, movement=-500000000 → clientComputed=3300000000
    // statement=3800000000 → clientBreak = 3300000000-3800000000 = -500000000
    const r = row({
      openingMinor: '3800000000',
      movementMinor: '-500000000',
      computedMinor: '3300000000',
      statementMinor: '3800000000',
      breakMinor: '-500000000',
    });
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{ [key(r)]: -500000000n }} />);
    // WHY: U+2212 (−) not hyphen-minus (-) for typographic correctness; negative = statement-over-book
    const breakEl = screen.getByLabelText(/material break/i);
    // text contains the minus char U+2212
    expect(breakEl.textContent).toMatch(/−/);
    // must NOT have a leading +
    expect(breakEl.textContent).not.toMatch(/^\+/);
  });

  it('shows NO drift warning when clientMovements matches DTO', () => {
    // WHY: the drift marker must only fire on genuine backend disagreement
    const r = row({});
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{ [key(r)]: 3800000000n }} />);
    expect(screen.queryByLabelText(/evidence drift/i)).not.toBeInTheDocument();
  });

  it('shows drift warning when clientMovements disagrees with DTO movementMinor', () => {
    // WHY: browser independently verifies backend — disagreement must be visible
    const r = row({ movementMinor: '3800000000' });
    const badClientMovement = 3700000000n; // disagrees by 100000000
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{ [key(r)]: badClientMovement }} />);
    expect(screen.getByLabelText(/evidence drift/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence drift.*browser recomputed.*≠.*backend/i)).toBeInTheDocument();
  });

  it('shows drift warning when key is ABSENT from clientMovements and movementMinor is non-zero (e.g. recompute error)', () => {
    // WHY: §5.1 — if recomputeMovements threw and returned {}, the absent key must NOT
    // silently fall back to the DTO value. 0n fallback means backend's non-zero movement
    // disagrees with client's 0, correctly surfacing the integrity gap as drift.
    const r = row({ movementMinor: '3800000000' });
    // Pass empty clientMovements — simulates recompute failure returning {}
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{}} />);
    expect(screen.getByLabelText(/evidence drift/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence drift.*browser recomputed.*≠.*backend/i)).toBeInTheDocument();
  });

  it('shows NO drift when key is ABSENT from clientMovements and movementMinor is zero', () => {
    // WHY: a legitimately zero-movement row (no JEs) with 0n fallback = 0 === 0 → no drift
    const r = row({ movementMinor: '0', computedMinor: '1200000000', breakMinor: '-2598000000' });
    render(<ReconTable rows={[r]} selectedKey={null} onSelect={() => {}} clientMovements={{}} />);
    expect(screen.queryByLabelText(/evidence drift/i)).not.toBeInTheDocument();
  });
});
