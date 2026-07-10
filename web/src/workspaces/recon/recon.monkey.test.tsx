// web/src/workspaces/recon/recon.monkey.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconTable, fmtMinor } from './ReconTable';
import { computeBreak } from '../../lib/reconBreak';
import type { ReconRowDTO } from '../../api/types';

describe('recon monkey', () => {
  it('fmtMinor handles huge BigInt and negative without precision loss', () => {
    expect(fmtMinor('999999999999999999999', 6)).toBe('999,999,999,999,999.999999');
    expect(fmtMinor('-500000', 6)).toBe('−0.500000');
  });

  it('zero decimals asset formats with no fractional part', () => {
    expect(fmtMinor('1234', 0)).toBe('1,234');
  });

  it('computeBreak with negative computed (over-credited book) stays signed', () => {
    const r = computeBreak('-100', '0', '0');
    expect(r.direction).toBe('statement-over');
    expect(r.material).toBe(true);
  });

  it('renders a statement-only row (computed 0) without crashing', () => {
    const row: ReconRowDTO = {
      wallet: '0xw', coinType: '0xdead::usdt::USDT', decimals: 6,
      openingMinor: '0', movementMinor: '0', computedMinor: '0', statementMinor: '750000000',
      breakMinor: '-750000000', thresholdMinor: '100000', material: true,
      control: { debitMinor: '0', creditMinor: '0', legs: 0 },
      provenance: { computed: 'book', statement: 'mock', chain: 'n/a' }, disposition: null,
    };
    render(<ReconTable rows={[row]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText('USDT')).toBeInTheDocument();
  });
});
