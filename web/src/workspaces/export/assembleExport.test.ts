import { describe, it, expect, beforeAll } from 'vitest';
import { assembleExport } from './assembleExport';
import { leafHash } from '../../lib/leafEncode';
import { recomputeRoot } from '../../lib/proofVerify';
import type { JournalDTO, EventDTO, AnchorDTO, InclusionProof } from '../../api/types';

// ── helpers ────────────────────────────────────────────────────────────────────

/** Balanced JE: 100 debit Cash, 100 credit Revenue */
function makeJe(idempotencyKey: string) {
  return {
    idempotencyKey,
    lineageHash: 'lh-' + idempotencyKey,
    reversalOf: null,
    lines: [
      { account: 'Cash', side: 'DEBIT' as const, amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
    ],
  };
}

function makeJournalRow(eventId: string, key: string, hash: string): JournalDTO {
  return { id: 'jr-' + key, eventId, idempotencyKey: key, leafHash: hash, je: makeJe(key) };
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

/** Build a minimal valid single-sibling InclusionProof that produces merkleRoot */
async function buildProof(lHash: string, merkleRoot: string): Promise<InclusionProof> {
  // For a single-leaf tree the Merkle root IS the leaf hash (no siblings needed).
  // But we want to exercise the sibling-fold path, so we construct a synthetic
  // sibling such that nodeHash(leafHash, sib) == merkleRoot.
  //
  // Simpler: use 0 siblings. The "root" produced by recomputeRoot with no siblings
  // is just the leaf hash itself. So we set merkleRoot = lHash for single-leaf tests.
  return {
    idempotencyKey: 'idem-single',
    leafIndex: 0,
    siblings: [],
    merkleRoot: lHash,
  };
}

// ── pre-computed leaf hashes ───────────────────────────────────────────────────

let HASH_A = '';
let HASH_B = '';

beforeAll(async () => {
  HASH_A = await leafHash(makeJe('idem-a'));
  HASH_B = await leafHash(makeJe('idem-b'));
});

// ── tests ─────────────────────────────────────────────────────────────────────

const BASE_ARGS = {
  entityId: 'acme',
  periodId: '2026-06',
  functionalCurrency: 'USD',
  scale: 2,
  generatedAt: '2026-06-10T00:00:00Z',
};

describe('assembleExport', () => {
  it('empty journal → ok:false kind:empty', async () => {
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [],
      events: [],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result).toEqual({ ok: false, kind: 'empty' });
  });

  it('imbalanced journal → ok:false kind:imbalance with debit/credit', async () => {
    const imbalancedJe = {
      idempotencyKey: 'imbal-1',
      lineageHash: 'lh-imbal',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '200', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      ],
    };
    const row: JournalDTO = {
      id: 'jr-imbal',
      eventId: 'evt-imbal',
      idempotencyKey: 'imbal-1',
      leafHash: 'deadbeef'.repeat(8), // 64 hex chars — doesn't matter for imbalance test
      je: imbalancedJe,
    };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-imbal')],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('imbalance');
      if (result.kind === 'imbalance') {
        expect(result.debit).toBe('200');
        expect(result.credit).toBe('100');
      }
    }
  });

  it('unanchored period → ok:true verified:false filename contains UNVERIFIED-DRAFT', async () => {
    const row = makeJournalRow('evt-a', 'idem-a', 'deadbeef'.repeat(8));
    // Anchor exists but for a different period — should not match
    const wrongAnchor = makeAnchor({ periodId: '2026-05', merkleRoot: 'aabbcc'.padEnd(64, '0') });
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-a')],
      anchors: [wrongAnchor],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
      expect(result.filename).toMatch(/UNVERIFIED-DRAFT\.zip$/);
      expect(result.zip).toBeInstanceOf(Uint8Array);
      expect(result.zip.length).toBeGreaterThan(0);
    }
  });

  it('verified happy path → ok:true verified:true correct filename + proofsVerified', async () => {
    // We need real leaf hash for the proof to pass L2
    const row: JournalDTO = {
      id: 'jr-a',
      eventId: 'evt-a',
      idempotencyKey: 'idem-a',
      leafHash: HASH_A, // real hash — set in beforeAll
      je: makeJe('idem-a'),
    };

    // For a zero-sibling proof, merkleRoot = leafHash
    const merkleRoot = HASH_A;
    const proof: InclusionProof = { idempotencyKey: 'idem-a', leafIndex: 0, siblings: [], merkleRoot };

    const anchor = makeAnchor({
      periodId: '2026-06',
      merkleRoot,
      leafCount: 1,
      seq: 1,
    });

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-a')],
      anchors: [anchor],
      fetchProof: async () => ({ anchors: [anchor], inclusionProof: proof }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.filename).toBe('export-acme-2026-06.zip');
      expect(result.summary.proofsVerified).toBe(1);
      expect(result.zip).toBeInstanceOf(Uint8Array);
      expect(result.zip.length).toBeGreaterThan(0);
    }
  });

  it('leaf mismatch (tampered je) → ok:false kind:error', async () => {
    // Row has the real hash of 'idem-a', but we tamper the je to use different lines
    const tamperedJe = {
      idempotencyKey: 'idem-a',
      lineageHash: 'lh-tampered',
      reversalOf: null,
      lines: [
        { account: 'Cash', side: 'DEBIT' as const, amountMinor: '999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
        { account: 'Revenue', side: 'CREDIT' as const, amountMinor: '999', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: '1' },
      ],
    };
    const row: JournalDTO = {
      id: 'jr-a',
      eventId: 'evt-a',
      idempotencyKey: 'idem-a',
      leafHash: HASH_A, // stored hash of original (correct) je
      je: tamperedJe,   // tampered content — will produce a different hash
    };

    const anchor = makeAnchor({ periodId: '2026-06', merkleRoot: HASH_A, leafCount: 1 });

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-a')],
      anchors: [anchor],
      fetchProof: async () => ({ anchors: [anchor], inclusionProof: { idempotencyKey: 'idem-a', leafIndex: 0, siblings: [], merkleRoot: HASH_A } }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
    }
  });

  it('proof fetch returns null on anchored period → ok:false kind:error (not silent draft)', async () => {
    const row: JournalDTO = {
      id: 'jr-a',
      eventId: 'evt-a',
      idempotencyKey: 'idem-a',
      leafHash: HASH_A,
      je: makeJe('idem-a'),
    };

    const anchor = makeAnchor({ periodId: '2026-06', merkleRoot: HASH_A, leafCount: 1 });

    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [makeEvent('evt-a')],
      anchors: [anchor],
      fetchProof: async () => ({ anchors: [anchor], inclusionProof: null }), // null proof!
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
      // Must NOT be a silent draft — it must be an explicit error
      expect(result.kind).not.toBe('empty');
    }
  });

  it('event with only timestampMs (no eventTime) → date is resolved from timestampMs', async () => {
    const row: JournalDTO = {
      id: 'jr-a',
      eventId: 'evt-ts',
      idempotencyKey: 'idem-a',
      leafHash: 'deadbeef'.repeat(8),
      je: makeJe('idem-a'),
    };
    const evWithTs: EventDTO = {
      id: 'evt-ts',
      entityId: 'acme',
      status: 'POSTED',
      normalized: { timestampMs: '1717200000000' }, // no eventTime
      ai: null,
      final: null,
      routing: null,
    };
    // No anchor → draft path, no L2 check
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [evWithTs],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
    }
  });

  it('event with no date fields → ok:false kind:error', async () => {
    const row: JournalDTO = {
      id: 'jr-a',
      eventId: 'evt-nodate',
      idempotencyKey: 'idem-a',
      leafHash: 'deadbeef'.repeat(8),
      je: makeJe('idem-a'),
    };
    const evNoDate: EventDTO = {
      id: 'evt-nodate',
      entityId: 'acme',
      status: 'POSTED',
      normalized: {}, // no eventTime, no timestampMs
      ai: null,
      final: null,
      routing: null,
    };
    const result = await assembleExport({
      ...BASE_ARGS,
      journal: [row],
      events: [evNoDate],
      anchors: [],
      fetchProof: async () => ({ anchors: [], inclusionProof: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('error');
    }
  });
});
