import { describe, it, expect } from 'vitest';
import { loadReconFixture } from '../src/reconciliation/fixture.js';

describe('loadReconFixture', () => {
  it('loads the acme demo rows with BigInt-valid minors', () => {
    const rows = loadReconFixture('acme:pilot-001');
    expect(rows.length).toBeGreaterThanOrEqual(4); // SUI, USDC error, WETH in-transit, statement-only
    const sui = rows.find((r) => r.coinType === '0x2::sui::SUI');
    expect(sui).toBeTruthy();
    expect(() => BigInt(sui!.openingMinor)).not.toThrow();
    // decimals removed from ReconFixtureRow (Task 7): the registry is the sole scale authority,
    // the fixture no longer carries it. Nothing to assert here anymore.
  });

  it('throws on unknown entity (fail-loud, no silent empty)', () => {
    expect(() => loadReconFixture('no:such')).toThrow(/no recon fixture/i);
  });
});
