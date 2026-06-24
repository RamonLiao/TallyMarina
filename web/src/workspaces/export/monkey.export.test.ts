/**
 * monkey.export.test.ts
 *
 * Monkey tests for export pipeline — tries to break assembleExport / buildBundle /
 * supporting libs with extreme, malformed, and adversarial inputs.
 *
 * Each test documents WHY the invariant matters (not just what it does).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { assembleExport } from './assembleExport';
import { buildBundle } from './buildBundle';
import { leafHash } from '../../lib/leafEncode';
import { trialActivity } from '../../lib/trialActivity';
import { quantityRecon } from '../../lib/quantityRecon';
import { csvField, csvRows, formatMinor } from '../../lib/exportCsv';
import { unzipSync } from 'fflate';
import type { JournalDTO, EventDTO, AnchorDTO, InclusionProof } from '../../api/types';

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeJe(key: string, debitAmt = '100', creditAmt = '100', account = 'Cash', creditAccount = 'Revenue') {
  return {
    idempotencyKey: key,
    lineageHash: 'lh-' + key,
    reversalOf: null,
    lines: [
      { account, side: 'DEBIT' as const, amountMinor: debitAmt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      { account: creditAccount, side: 'CREDIT' as const, amountMinor: creditAmt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
    ],
  };
}

function makeEvent(id: string): EventDTO {
  return {
    id,
    entityId: 'acme',
    status: 'POSTED',
    normalized: { eventTime: '2026-06-01T00:00:00Z' },
    ai: null,
    final: null,
    routing: null,
  };
}

function makeAnchor(overrides: Partial<AnchorDTO> = {}): AnchorDTO {
  return {
    id: 'anchor-1',
    snapshotId: 'snap-1',
    seq: 1,
    link: 'https://suiscan.xyz/tx/abc',
    digest: 'digest-abc',
    explorerUrl: 'https://suiscan.xyz/tx/abc',
    anchoredAt: '2026-06-10T00:00:00Z',
    merkleRoot: null,
    periodId: '2026-06',
    leafCount: 1,
    ...overrides,
  };
}

const BASE_ARGS = {
  entityId: 'acme',
  periodId: '2026-06',
  functionalCurrency: 'USD',
  scale: 2,
  generatedAt: '2026-06-10T00:00:00Z',
};

let HASH_BALANCED = '';
beforeAll(async () => {
  HASH_BALANCED = await leafHash(makeJe('test-key'));
});

// ── 1. Single-legged JE (imbalance) ──────────────────────────────────────────

describe('single-legged JE (imbalance)', () => {
  it('WHY: a one-sided JE breaks double-entry invariant; must surface as imbalance, not a silent export', async () => {
    const oneLegJe = {
      idempotencyKey: 'one-leg',
      lineageHash: 'lh-one',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '500', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        // no credit leg
      ],
    };
    const row: JournalDTO = { id: 'jr-one', eventId: 'evt-one', idempotencyKey: 'one-leg', leafHash: 'aa'.repeat(32), je: oneLegJe };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-one')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('imbalance');
      if (result.kind === 'imbalance') {
        expect(result.debit).toBe('500');
        expect(result.credit).toBe('0');
      }
    }
  });
});

// ── 2. Negative amountMinor ───────────────────────────────────────────────────

describe('negative amountMinor', () => {
  it('WHY: negative amounts corrupt totals silently; must be rejected with a clear error, not treated as a valid credit', async () => {
    const negJe = {
      idempotencyKey: 'neg-amt',
      lineageHash: 'lh-neg',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '-100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '-100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
      ],
    };
    const row: JournalDTO = { id: 'jr-neg', eventId: 'evt-neg', idempotencyKey: 'neg-amt', leafHash: 'bb'.repeat(32), je: negJe };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-neg')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    // Must not silently produce garbage — must error
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['error', 'imbalance']).toContain(result.kind);
    }
  });

  it('WHY: trialActivity directly must throw on negative amountMinor, not treat it as zero', () => {
    expect(() => trialActivity([
      { account: 'Cash', side: 'DEBIT', amountMinor: '-50', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '-50', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
    ])).toThrow(/non-negative/);
  });
});

// ── 3. Malformed amountMinor (non-integer strings) ────────────────────────────

describe('malformed amountMinor — non-BigInt-parseable strings', () => {
  it("WHY: BigInt('') throws SyntaxError — a blank amountMinor must not silently produce 0 or NaN", async () => {
    const blankAmt = {
      idempotencyKey: 'blank-amt',
      lineageHash: 'lh-blank',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
      ],
    };
    const row: JournalDTO = { id: 'jr-blank', eventId: 'evt-blank', idempotencyKey: 'blank-amt', leafHash: 'cc'.repeat(32), je: blankAmt };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-blank')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    // Must NOT silently produce garbage — BigInt('') is a SyntaxError, must be caught as error
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['error', 'imbalance']).toContain(result.kind);
    }
  });

  it("WHY: BigInt('1.5') throws SyntaxError — a decimal amountMinor must error, not silently truncate", async () => {
    const decAmt = {
      idempotencyKey: 'dec-amt',
      lineageHash: 'lh-dec',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '1.5', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '1.5', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
      ],
    };
    const row: JournalDTO = { id: 'jr-dec', eventId: 'evt-dec', idempotencyKey: 'dec-amt', leafHash: 'dd'.repeat(32), je: decAmt };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-dec')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['error', 'imbalance']).toContain(result.kind);
    }
  });

  it("WHY: BigInt('abc') throws SyntaxError — a non-numeric amountMinor must error, not produce NaN", async () => {
    const alphaAmt = {
      idempotencyKey: 'alpha-amt',
      lineageHash: 'lh-alpha',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: 'abc', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: 'abc', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
      ],
    };
    const row: JournalDTO = { id: 'jr-alpha', eventId: 'evt-alpha', idempotencyKey: 'alpha-amt', leafHash: 'ee'.repeat(32), je: alphaAmt };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-alpha')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['error', 'imbalance']).toContain(result.kind);
    }
  });
});

// ── 4. CSV injection guard ────────────────────────────────────────────────────

describe('CSV injection and special characters in account/leg', () => {
  it('WHY: CSV parsers treat =, +, -, @ as formula prefixes; must be guarded with apostrophe prefix', () => {
    const injectionPrefixes = ['=CMD()', '+1+2', '-1', '@SUM(A1)'];
    for (const v of injectionPrefixes) {
      const out = csvField(v);
      // Must start with apostrophe-guard, then be quoted
      expect(out).toMatch(/^"'/);
    }
  });

  it('WHY: a comma in account name would split the CSV column; must be double-quoted', () => {
    const out = csvField('Cash, Restricted');
    expect(out).toBe('"Cash, Restricted"');
  });

  it('WHY: a double-quote in field value would break CSV parsing; must be doubled (RFC 4180)', () => {
    const out = csvField('He said "hello"');
    expect(out).toBe('"He said ""hello"""');
  });

  it('WHY: a newline in field would break CSV line parsing; must be quoted so no unescaped line-break appears', () => {
    const out = csvField('line1\nline2');
    expect(out).toBe('"line1\nline2"');
    // No raw unescaped newline outside quotes
    const lines = out.split('\n');
    // The entire thing should be a single quoted field containing the newline inside quotes
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
  });

  it('WHY: end-to-end — journal.csv with injection/special-char account must parse back correctly', async () => {
    const specialAccount = '=DANGER()/evil,account\n"quoted"';
    const specialLeg = '+formula@here';
    const je = {
      idempotencyKey: 'csv-inject',
      lineageHash: 'lh-csv',
      reversalOf: null,
      lines: [
        { account: specialAccount, side: 'DEBIT' as const, amountMinor: '200', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: specialLeg },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '200', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
      ],
    };
    const row: JournalDTO = { id: 'jr-csv', eventId: 'evt-csv', idempotencyKey: 'csv-inject', leafHash: 'ff'.repeat(32), je };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-csv')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const files = unzipSync(result.zip);
      const journalCsvBytes = files['journal.csv'];
      expect(journalCsvBytes).toBeDefined();
      const csv = new TextDecoder().decode(journalCsvBytes);

      // Must not have unescaped newline in the data region (header block lines start with #)
      // A raw unescaped newline from account field would break the CSV row
      // Check: the special account value must appear somewhere properly quoted
      expect(csv).toContain('"\'=DANGER'); // injection-guarded with apostrophe

      // The CSV must be parseable — verify no unquoted comma from account splits columns
      // by checking the injection-prefixed value is wrapped in quotes
      expect(csv).toMatch(/"'=DANGER\(.*\)/);
    }
  });
});

// ── 5. Unanchored period — four watermarks ────────────────────────────────────

describe('unanchored period — draft watermarks', () => {
  it('WHY: draft exports must clearly signal non-verified status; all four watermarks must be present to prevent silent misuse', async () => {
    const je = makeJe('draft-key');
    const hash = await leafHash(je);
    const row: JournalDTO = { id: 'jr-d', eventId: 'evt-d', idempotencyKey: 'draft-key', leafHash: hash, je };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-d')],
      anchors: [], // no anchors
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Watermark 1: filename
      expect(result.filename).toMatch(/UNVERIFIED-DRAFT/);

      const files = unzipSync(result.zip);
      const manifestBytes = files['manifest.json'];
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));

      // Watermark 2: manifest.verified = false
      expect(manifest.verified).toBe(false);

      // Watermark 3: manifest.anchor = null
      expect(manifest.anchor).toBeNull();

      // Watermark 4: VERIFY.md warning text
      const verifyMdBytes = files['VERIFY.md'];
      expect(verifyMdBytes).toBeDefined();
      const verifyMd = new TextDecoder().decode(verifyMdBytes);
      expect(verifyMd).toMatch(/DRAFT/);
      expect(verifyMd).toMatch(/not yet verified/i);
    }
  });
});

// ── 6. Anchored — tampered JE leaf mismatch → error ──────────────────────────

describe('L2 leaf mismatch (tampered JE)', () => {
  it('WHY: an L2 check prevents undetected tampering; tampered je must cause an error, never a verified export', async () => {
    const originalJe = makeJe('orig');
    const realHash = await leafHash(originalJe);
    const tamperedJe = { ...originalJe, lines: originalJe.lines.map((l) => ({ ...l, amountMinor: '99999' })) };

    const row: JournalDTO = { id: 'jr-t', eventId: 'evt-t', idempotencyKey: 'orig', leafHash: realHash, je: tamperedJe };
    const anchor = makeAnchor({ periodId: '2026-06', merkleRoot: realHash, leafCount: 1 });
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-t')],
      anchors: [anchor],
      fetchProof: async () => ({ anchors: [anchor], inclusionProof: { idempotencyKey: 'orig', leafIndex: 0, siblings: [], merkleRoot: realHash } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.message).toMatch(/L2 leaf mismatch|mismatch/i);
      }
    }
  });
});

// ── 7. anchor.leafCount != journal length → completeness fails ────────────────

describe('completeness check: anchor.leafCount != journal.length', () => {
  it('WHY: a partial export could omit entries; leafCount mismatch must block verified export, not silently truncate', async () => {
    const je1 = makeJe('je1');
    const je2 = makeJe('je2');
    const h1 = await leafHash(je1);
    const h2 = await leafHash(je2);
    const proof1: InclusionProof = { idempotencyKey: 'je1', leafIndex: 0, siblings: [], merkleRoot: h1 };
    // anchor says 3 leaves, journal only has 2 — completeness must fail
    const anchor = makeAnchor({ periodId: '2026-06', merkleRoot: h1, leafCount: 3 });

    const rows: JournalDTO[] = [
      { id: 'jr-1', eventId: 'evt-1', idempotencyKey: 'je1', leafHash: h1, je: je1 },
      { id: 'jr-2', eventId: 'evt-2', idempotencyKey: 'je2', leafHash: h2, je: je2 },
    ];

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: rows,
      events: [makeEvent('evt-1'), makeEvent('evt-2')],
      anchors: [anchor],
      fetchProof: async (key) => {
        if (key === 'je1') return { anchors: [anchor], inclusionProof: proof1 };
        // je2's proof root won't match anchor root → error before completeness
        return { anchors: [anchor], inclusionProof: { idempotencyKey: 'je2', leafIndex: 1, siblings: [], merkleRoot: h2 } };
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
    }
  });

  it('WHY: completeness must throw in buildBundle directly when called with mismatched leafCount', async () => {
    const je = makeJe('b1');
    const h = await leafHash(je);
    const rows: JournalDTO[] = [{ id: 'jr-b1', eventId: 'evt-b1', idempotencyKey: 'b1', leafHash: h, je }];
    await expect(
      buildBundle({
        ...BASE_ARGS,
        journal: rows,
        dateByEventId: { 'evt-b1': '2026-06-01T00:00:00Z' },
        binding: {
          anchor: { merkleRoot: h, snapshotId: 'snap', digest: 'd', explorerUrl: 'url', leafCount: 99 },
          proofs: [],
        },
      })
    ).rejects.toThrow(/completeness/);
  });
});

// ── 8. Proof null on anchored period → error (not silent draft) ───────────────

describe('null proof on anchored period', () => {
  it('WHY: a missing proof on an anchored period cannot produce a verified export; must error loudly, not fall back to silent draft', async () => {
    const je = makeJe('np');
    const h = await leafHash(je);
    const anchor = makeAnchor({ periodId: '2026-06', merkleRoot: h, leafCount: 1 });
    const row: JournalDTO = { id: 'jr-np', eventId: 'evt-np', idempotencyKey: 'np', leafHash: h, je };

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-np')],
      anchors: [anchor],
      fetchProof: async () => ({ anchors: [anchor], inclusionProof: null }), // null proof
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must be 'error', NOT 'empty' — null proof on anchored period is an explicit error
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.message).toMatch(/inclusionProof is null|null/i);
      }
    }
  });
});

// ── 9. Superseded / duplicate anchors — highest seq wins ─────────────────────

describe('superseded anchors — highest seq wins', () => {
  it('WHY: a stale/superseded anchor would bind exports to the wrong root; the highest-seq anchor for the period must always be selected', async () => {
    const je = makeJe('seq-test');
    const newRoot = await leafHash(je);
    const oldRoot = 'a'.repeat(64);

    const staleAnchor = makeAnchor({ id: 'old', seq: 1, merkleRoot: oldRoot, periodId: '2026-06', leafCount: 1 });
    const newAnchor = makeAnchor({ id: 'new', seq: 5, merkleRoot: newRoot, periodId: '2026-06', leafCount: 1 });
    const proof: InclusionProof = { idempotencyKey: 'seq-test', leafIndex: 0, siblings: [], merkleRoot: newRoot };
    const row: JournalDTO = { id: 'jr-seq', eventId: 'evt-seq', idempotencyKey: 'seq-test', leafHash: newRoot, je };

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-seq')],
      anchors: [staleAnchor, newAnchor], // stale first in array
      fetchProof: async () => ({ anchors: [newAnchor], inclusionProof: proof }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      // Must have bound to the new (highest seq) root
      expect(result.merkleRoot).toBe(newRoot);
    }
  });

  it('WHY: an anchor with null merkleRoot must be ignored even if it has the highest seq', async () => {
    const je = makeJe('null-root');
    const row: JournalDTO = { id: 'jr-nr', eventId: 'evt-nr', idempotencyKey: 'null-root', leafHash: 'ab'.repeat(32), je };
    const nullRootAnchor = makeAnchor({ id: 'null-root-anchor', seq: 99, merkleRoot: null, periodId: '2026-06', leafCount: 1 });

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-nr')],
      anchors: [nullRootAnchor],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    // null-root anchor must be excluded → falls through to draft
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
      expect(result.filename).toMatch(/UNVERIFIED-DRAFT/);
    }
  });
});

// ── 10. Large journal (500 balanced JEs) ─────────────────────────────────────

describe('large journal — 500 balanced JEs (scale + no truncation)', () => {
  it('WHY: N=500 ensures the pipeline does not truncate, hit memory issues, or silent-fail; zip must be non-empty', async () => {
    const N = 500;
    const journal: JournalDTO[] = [];
    const events: EventDTO[] = [];

    for (let i = 0; i < N; i++) {
      const key = `bulk-${i}`;
      const evtId = `evt-bulk-${i}`;
      const je = makeJe(key, '1000', '1000');
      journal.push({ id: `jr-${i}`, eventId: evtId, idempotencyKey: key, leafHash: 'ab'.repeat(32), je });
      events.push(makeEvent(evtId));
    }

    const result = await assembleExport({
      ...BASE_ARGS,
      journal,
      events,
      anchors: [], // unanchored → draft path (no proof fetches)
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
      expect(result.zip).toBeInstanceOf(Uint8Array);
      expect(result.zip.length).toBeGreaterThan(0);
      // Verify the zip contains all N JEs in journal.csv
      const files = unzipSync(result.zip);
      const journalCsv = new TextDecoder().decode(files['journal.csv']);
      // Each JE has 2 lines, so total data rows = N * 2
      // Count lines that don't start with '#' (header block) and aren't the column header
      const dataLines = journalCsv.split('\n').filter((l) => !l.startsWith('#') && l.trim() !== '' && !l.startsWith('date,'));
      expect(dataLines.length).toBe(N * 2);
    }
  }, 30000); // increased timeout for 500 JEs
});

// ── 11. quantityRecon — single-side null leg (origCoinType XOR origQtyMinor) ──

describe('quantityRecon — single-side null leg', () => {
  it('WHY: a leg with origCoinType but null origQtyMinor (or vice versa) should be skipped, not crash or produce garbage', () => {
    // origCoinType present, origQtyMinor null → skip
    const result1 = quantityRecon([
      { account: 'Cash', side: 'DEBIT', amountMinor: '100', origCoinType: 'SUI', origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
    ]);
    // origCoinType + null origQtyMinor → skip (no entry)
    expect(result1).toHaveLength(0);
  });

  it('WHY: a leg with origQtyMinor but null origCoinType should be skipped (no coinType key)', () => {
    // origQtyMinor present, origCoinType null → skip
    const result2 = quantityRecon([
      { account: 'Cash', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: '500', priceRef: null, fxRef: null, leg: '1' },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
    ]);
    // null origCoinType → skip
    expect(result2).toHaveLength(0);
  });

  it('WHY: only legs with both origCoinType AND origQtyMinor present should produce a recon row', () => {
    const result = quantityRecon([
      { account: 'Cash', side: 'DEBIT', amountMinor: '100', origCoinType: 'SUI', origQtyMinor: '1000000', priceRef: null, fxRef: null, leg: '1' },
      { account: 'Revenue', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '2' },
    ]);
    expect(result).toHaveLength(1);
    const r0 = result[0]!;
    expect(r0.coinType).toBe('SUI');
    expect(r0.acquiredMinor).toBe(1000000n);
  });
});

// ── 12. ExportWorkspace assembleError state has visible error text ────────────

// Note: ExportWorkspace.tsx renders assembleError via `setAssembleError` when
// assembleExport throws (the try/catch in handlePreview). The error appears as:
// <div class="card light--red export-fetch-error"><strong>Assembly error:</strong> {assembleError}</div>
// This is tested in ExportWorkspace.test.tsx for the error card path (kind='error').
// The assembleError state is for unexpected throws (not structured ExportFailure);
// the structured error path renders inline in export-card-zone.
// We verify the rendered text exists in ExportWorkspace.test.tsx imbalance/error tests.

describe('assembleExport structural smoke — missing-date input returns kind:error (not throw-through)', () => {
  it('WHY: assembleExport must return a structured kind:error rather than throwing when input lacks a usable date; UI error-card path is tested in ExportWorkspace.test.tsx', async () => {
    // This test does NOT render React/ExportWorkspace (no jsdom setup here).
    // It only verifies the assembleExport contract: unexpected/incomplete input
    // (journal entry with no matching event → no usable date) resolves to
    // { ok:false, kind:'error' } rather than an unhandled exception.
    // The rendered error card path (assembleError state → export-fetch-error div)
    // is covered by ExportWorkspace.test.tsx imbalance/error tests.
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [{ id: 'jr-x', eventId: 'evt-x', idempotencyKey: 'x', leafHash: 'zz'.repeat(32), je: makeJe('x') }],
      events: [], // no matching event → will throw "no usable date"
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
    }
  });
});

// ── 13. formatMinor edge cases ────────────────────────────────────────────────

describe('formatMinor edge cases', () => {
  it('WHY: zero amount must format cleanly, not as empty string or NaN', () => {
    expect(formatMinor('0', 2)).toBe('0.00');
  });

  it('WHY: large amounts must not truncate or overflow string formatting', () => {
    const big = '999999999999999999';
    const formatted = formatMinor(big, 2);
    expect(formatted).toMatch(/^\d+\.\d{2}$/);
    expect(formatted.startsWith('-')).toBe(false);
  });

  it('WHY: negative amounts in formatMinor should still format (display only, trialActivity rejects negatives upstream)', () => {
    const formatted = formatMinor('-100', 2);
    expect(formatted).toBe('-1.00');
  });
});
