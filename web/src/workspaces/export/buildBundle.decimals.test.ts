import { describe, it, expect } from 'vitest';
import { buildBundle, UnregisteredAssetError } from './buildBundle';
import type { BundleInput } from './buildBundle';
import type { JournalDTO } from '../../api/types';

// A minimal, balanced draft bundle input with exactly one asset leg (DEBIT, carrying the
// given origCoinType/origDecimals/origQtyMinor) and a balancing fiat CREDIT leg with no asset.
// Balanced so trialActivity does not throw ImbalanceError before we reach the columns.
function bundleInputWith(line: {
  origCoinType: string;
  decimals: number | null;
  origQtyMinor: string | null;
  source?: 'chain' | 'manual';
}): BundleInput {
  const je: JournalDTO = {
    id: 'je1',
    eventId: 'ev1',
    idempotencyKey: 'ik1',
    leafHash: 'leaf-je1',
    je: {
      idempotencyKey: 'ik1',
      lineageHash: 'lh1',
      reversalOf: null,
      lines: [
        {
          account: 'DigitalAssets', side: 'DEBIT', amountMinor: '10000',
          origCoinType: line.origCoinType, origQtyMinor: line.origQtyMinor,
          origDecimals: line.decimals, origSource: line.source ?? 'chain',
          priceRef: null, fxRef: null, leg: 'ACQUISITION',
        },
        {
          account: 'Equity', side: 'CREDIT', amountMinor: '10000',
          origCoinType: null, origQtyMinor: null,
          origDecimals: null, origSource: null,
          priceRef: null, fxRef: null, leg: 'OPENING_EQUITY',
        },
      ],
    },
  };
  return {
    entityId: 'ent-1', periodId: 'p1', functionalCurrency: 'USD', scale: 2,
    generatedAt: '2026-01-31T00:00:00Z', journal: [je],
    dateByEventId: { ev1: '2026-01-01' }, binding: null,
  };
}

// Strip the '#'-prefixed meta header block, split remaining CSV rows, return the named
// column's values (data rows only, header excluded).
function journalColumn(csv: string, name: string): string[] {
  const rows = csv.split('\n').filter((l) => !l.startsWith('#') && l.trim() !== '');
  const header = rows[0]!.split(',');
  const idx = header.indexOf(name);
  if (idx < 0) throw new Error(`column ${name} not found in header: ${header.join(',')}`);
  return rows.slice(1).map((r) => r.split(',')[idx]!);
}

function file(files: { name: string; content: string }[], name: string): string {
  return files.find((f) => f.name === name)!.content;
}

describe('journal.csv decimals columns', () => {
  it('emits origDecimals, an exact origQty string, and the asset source header', async () => {
    const out = await buildBundle(bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1200000000' }));
    const header = file(out.files, 'journal.csv').split('\n').find((l) => l.includes('origCoinType'))!;
    expect(header).toContain('origDecimals');
    expect(header).toContain('origQty');
    expect(header).toContain('origSource');
  });

  it('never trims trailing zeros and never uses a locale separator', async () => {
    // WHY: an ERP importing in a comma-decimal locale silently misplaces the point.
    // That is the exact class of silent scale error this whole spec exists to kill.
    const journal = file((await buildBundle(bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1200000000' }))).files, 'journal.csv');
    const qty = journalColumn(journal, 'origQty');
    expect(qty).toContain('1.200000000');
    expect(qty).not.toContain('1.2');   // no trailing-zero trimming
    expect(journal).not.toMatch(/1,2/); // no comma decimal separator
  });

  it('emits no decimal point at all for a 0-decimal asset', async () => {
    // WHY: formatMinor(x, 0) must yield "1200", not "1200." — a trailing point breaks
    // strict numeric parsers on the ERP side.
    const journal = file((await buildBundle(bundleInputWith({ origCoinType: '0xzero::z::Z', decimals: 0, origQtyMinor: '1200' }))).files, 'journal.csv');
    const qtyCol = journalColumn(journal, 'origQty');
    expect(qtyCol).toContain('1200');
    expect(journal).not.toContain('1200.');
  });

  it('stamps the per-row asset source so an ERP importing rows (never the manifest) sees it', async () => {
    const journal = file((await buildBundle(bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1', source: 'manual' }))).files, 'journal.csv');
    expect(journalColumn(journal, 'origSource')).toContain('manual');
    expect(journalColumn(journal, 'origDecimals')).toContain('9');
  });
});

describe('quantity-recon.csv decimals columns', () => {
  it('carries decimals, source, and exact rescaled strings alongside the *Minor integers', async () => {
    const recon = file((await buildBundle(bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1200000000' }))).files, 'quantity-recon.csv');
    const header = recon.split('\n').find((l) => l.includes('coinType'))!;
    for (const col of ['decimals', 'source', 'acquiredMinor', 'acquired', 'disposedMinor', 'disposed', 'netMinor', 'net']) {
      expect(header).toContain(col);
    }
    expect(journalColumn(recon, 'acquired')).toContain('1.200000000');
    expect(journalColumn(recon, 'acquiredMinor')).toContain('1200000000');
    expect(journalColumn(recon, 'decimals')).toContain('9');
  });
});

describe('export is fail-closed on unknown scale', () => {
  const withoutScale = bundleInputWith({ origCoinType: '0xusdc::usdc::USDC', decimals: null, origQtyMinor: '5000000000' });

  it('refuses to build a bundle containing an unregistered asset', async () => {
    // WHY: a quantity without a scale entering an ERP is interpreted at *some* scale.
    // Refusing is the only honest option.
    await expect(buildBundle(withoutScale)).rejects.toThrow(UnregisteredAssetError);
  });

  it('names every offending coinType so the user can go register them', async () => {
    await expect(buildBundle(withoutScale)).rejects.toMatchObject({
      coinTypes: ['0xusdc::usdc::USDC'],
    });
  });

  it('throws before writing any row — no partial bundle escapes', async () => {
    // WHY: the whole point is that an under-scaled quantity must never reach an ERP. If a
    // single row were emitted before the throw, that guarantee is already broken.
    let built: unknown = 'NOT_SET';
    try { built = await buildBundle(withoutScale); } catch { /* expected */ }
    expect(built).toBe('NOT_SET');
  });
});

describe('export is fail-closed on a malformed (not just missing) scale', () => {
  // WHY: origDecimals == null is not the only way a scale can be wrong. A fractional or
  // out-of-range decimals is just as unsafe to write into an ERP as a missing one — the
  // guard must reject the whole class, not just the null case. These inputs are not reachable
  // in production today (getAssetDecimals validates integer 0-36 at registration time, and the
  // DB has a CHECK constraint), but export is a compliance artifact and must not assume the
  // upstream is correct.

  it('rejects a fractional origDecimals even when origQtyMinor is null (fiat-shaped leg with an asset coinType)', async () => {
    // WHY: a fractional scale on a leg with no quantity to format never reaches formatMinor,
    // so formatMinor's own guard can't catch it. Without a scan-level check, String(9.5) would
    // be written straight into journal.csv's origDecimals column, uncaught, no throw.
    const bad = bundleInputWith({ origCoinType: '0xfrac::f::F', decimals: 9.5, origQtyMinor: null });
    await expect(buildBundle(bad)).rejects.toBeInstanceOf(UnregisteredAssetError);
    await expect(buildBundle(bad)).rejects.toMatchObject({ coinTypes: ['0xfrac::f::F'] });
  });

  it('rejects a negative origDecimals with a typed error carrying the coinType, not a generic Error', async () => {
    // WHY: formatMinor also rejects negative scale, but throws a generic Error — which means
    // the coinType is lost and the UI falls back to a generic error card instead of the
    // "unregistered asset" card. The scan-level guard must catch this first so the error is
    // typed and named.
    const bad = bundleInputWith({ origCoinType: '0xneg::n::N', decimals: -3, origQtyMinor: '100' });
    await expect(buildBundle(bad)).rejects.toBeInstanceOf(UnregisteredAssetError);
    await expect(buildBundle(bad)).rejects.toMatchObject({ coinTypes: ['0xneg::n::N'] });
  });

  it('rejects an origDecimals above 36 (mirrors the rules-engine assetDecimals bound, guards against 10^n BigInt DoS)', async () => {
    const bad = bundleInputWith({ origCoinType: '0xbig::b::B', decimals: 37, origQtyMinor: '100' });
    await expect(buildBundle(bad)).rejects.toBeInstanceOf(UnregisteredAssetError);
    await expect(buildBundle(bad)).rejects.toMatchObject({ coinTypes: ['0xbig::b::B'] });
  });

  it('does not flag the fiat/gas leg (origCoinType null, origDecimals null) as an unregistered asset', async () => {
    // WHY: regression guard — the scan condition must be "origCoinType present AND scale
    // invalid". bundleInputWith's balancing CREDIT leg is exactly this shape (origCoinType:
    // null, origDecimals: null); if the scan were mutated to check origDecimals alone (dropping
    // the origCoinType != null guard), this leg would be wrongly swept up and every build in
    // this file would start throwing. A build with only a well-scaled asset leg must succeed.
    const ok = bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1000000000' });
    await expect(buildBundle(ok)).resolves.toBeTruthy();
  });
});
