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
  origQtyMinor: string;
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
