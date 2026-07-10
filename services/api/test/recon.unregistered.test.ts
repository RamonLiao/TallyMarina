import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { collectBreaks } from '../src/reconciliation/collect.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reconunreg-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('acme:pilot-001','ACME','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

describe('collectBreaks with an unregistered asset', () => {
  it('surfaces the row with null decimals instead of guessing 9', () => {
    // WHY: recon.collect.test.ts:44 pins that a book-only asset must appear on screen.
    // Throwing would erase it — worse than printing it wrong. Guessing 9 is the bug.
    const db = freshDb();
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType.includes('usdc'))!;
    expect(usdc.decimals).toBeNull();
    expect(usdc.unregisteredAsset).toBe(true);
    expect(usdc.precision).toBeNull();
  });

  it('computes decimals, source and precision once the asset is registered', () => {
    const db = freshDb();
    registerTestAsset(db, 'acme:pilot-001', '0xbeef::usdc::USDC', 6);
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType.includes('usdc'))!;
    expect(usdc.decimals).toBe(6);
    expect(usdc.unregisteredAsset).toBe(false);
    expect(usdc.assetSource).toBe('chain');
    // Fixture: opening 5000000000 - statement 5000500000, no book movement => break -500000 at 6dp.
    // breakPrecision('-500000', 6) computed by hand from precision.ts:
    //   s='500000', trailingZeros=5 => lastSignificantDecimal = max(0, 6-5) = 1
    //   intPart '0' => frac '500000', first nonzero at index 0 => flatToDecimal 0, firstSignificant 1
    expect(usdc.precision).toEqual({
      exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1,
    });
  });
});
