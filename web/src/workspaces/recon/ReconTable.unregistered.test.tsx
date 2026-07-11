import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconTable, fmtMinor } from './ReconTable';
import type { ReconRowDTO } from '../../api/types';

// An unregistered asset: the wire sends decimals:null. fmtMinor cannot be called with a scale it
// does not have, so the row must render RAW minor units, never a fabricated 9dp/6dp reading.
const unregistered: ReconRowDTO = {
  wallet: '0x7a', coinType: '0xbeef::usdc::USDC', decimals: null, symbol: null,
  assetSource: null, unregisteredAsset: true, precision: null,
  openingMinor: '5000000000', movementMinor: '0', computedMinor: '5000000000',
  statementMinor: '5000500000', breakMinor: '-500000', thresholdMinor: '1000000',
  material: true, control: { debitMinor: '0', creditMinor: '0', legs: 0 },
  provenance: { computed: 'book', statement: 'mock', chain: 'n/a' },
  disposition: null,
};

// The same balance once the asset is registered at 6dp. The break is -0.500000 (flat to decimal 0,
// significant from decimal 1), so the precision profile must dim "−0." and keep "500000" full-ink.
const registered: ReconRowDTO = {
  ...unregistered, decimals: 6, symbol: 'USDC', assetSource: 'chain', unregisteredAsset: false,
  precision: { exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1 },
};

describe('fmtMinor refuses a scale it does not have', () => {
  it('fmtMinor must not silently treat a null scale as 0', () => {
    // WHY: this is the ?? 9 bug's third form. The first wrote a default by hand. The second hid
    // one inside the SDK (`decimals ?? 0`). This one needs no `??` at all — null + 1 is 1, and JS
    // hands you a wrong scale for free (5000000000 → "5,000,000,000" not "5,000.000000", off by 1e6).
    // A regex guard cannot see it. Only a runtime type check can.
    expect(() => fmtMinor('5000000000', null as unknown as number)).toThrow();
  });

  it('fmtMinor rejects a non-integer scale', () => {
    expect(() => fmtMinor('5000000000', 6.5)).toThrow();
  });
});

describe('ReconTable with an unregistered asset', () => {
  it('renders raw minor units and says the scale is unknown', () => {
    render(<ReconTable rows={[unregistered]} selectedKey={null} onSelect={() => {}} />);
    // Raw minor units, verbatim — NOT run through fmtMinor.
    expect(screen.getAllByText('5000000000').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/scale unknown/i).length).toBeGreaterThan(0);
  });

  it('shows the unregistered pill', () => {
    render(<ReconTable rows={[unregistered]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/unregistered/i)).toBeInTheDocument();
  });

  it('formats amounts and shows the precision profile once registered', () => {
    render(<ReconTable rows={[registered]} selectedKey={null} onSelect={() => {}} />);
    // Registered → real scale, real formatting. Opening and Computed both = 5000000000 → two cells.
    expect(screen.getAllByText(/5,000\.000000/).length).toBeGreaterThan(0);
    // The profile is announced via aria-describedby → a visually-hidden span (NOT an aria-label on
    // the number, which would override the number's own readout and nest inside the verdict label).
    // D9: information, not verdict.
    expect(screen.getByText(/flat to decimal 0; unflat from decimal 1/i)).toBeInTheDocument();
  });
});
