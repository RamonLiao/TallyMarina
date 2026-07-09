import { describe, it, expect, beforeEach } from 'vitest';
import { netByCoinType, walletAssetMovements } from '../src/reconciliation/movement.js';
import { origMemo } from '../../../web/src/lib/balance.js';
import { recomputeMovements } from '../../../web/src/lib/reconMovements.js';
import { openDb, type Db } from '../src/store/db.js';
import { insertEvent, getEvent } from '../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';

// JE fixtures spanning the edges: multi-coin, null legs, debit/credit netting, large BigInt.
const FIXTURES = [
  [
    { account: '1000', side: 'DEBIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10' },
    { account: '4000', side: 'CREDIT', amountMinor: '250', origCoinType: null, origQtyMinor: null },
  ],
  [
    { account: '1000', side: 'CREDIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7' },
    { account: '6000', side: 'DEBIT', amountMinor: '999999999999999999999', origCoinType: '0xusdc::usdc::USDC', origQtyMinor: '999999999999999999999' },
  ],
];

describe('netByCoinType parity with web origMemo', () => {
  for (const [i, lines] of FIXTURES.entries()) {
    it(`fixture ${i} produces byte-identical net map`, () => {
      const backend = netByCoinType(lines as never);
      const web = origMemo(lines as never);
      // Compare as sorted [coinType, string] tuples — bigint-safe equality.
      const norm = (m: Record<string, bigint>) =>
        Object.entries(m).map(([k, v]) => [k, v.toString()]).sort();
      expect(norm(backend)).toEqual(norm(web));
    });
  }
});

// ── Fold-level parity ──────────────────────────────────────────────────────────
// WHY this exists on top of the netByCoinType parity above: the netting primitive was the
// only thing pinned, but the OPENING_LOT exclusion lives one level UP, in the per-JE fold.
// The guard sat below the divergence it was meant to catch — the client double-counted
// opening lots as period movement and printed a phantom break on the recon screen while
// every parity test stayed green. Pin the fold, not just the primitive.
const ENTITY = 'acme:pilot-001';
const SUI = '0x2::sui::SUI';
const WALLET = '0xacmeTreasury';

const acquisitionLines = (qty: string) => [
  { account: 'DigitalAssets', side: 'DEBIT', amountMinor: qty, origCoinType: SUI, origQtyMinor: qty, priceRef: null, fxRef: null, leg: 'ACQUISITION' },
  { account: 'Equity', side: 'CREDIT', amountMinor: qty, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
];

describe('walletAssetMovements parity with web recomputeMovements (fold level)', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  });

  function seed(eventId: string, rawType: string, qty: string, finalType?: string | null, finalPurpose?: string) {
    insertEvent(db, { id: eventId, entityId: ENTITY, rawJson: JSON.stringify({ wallet: WALLET, coinType: SUI, eventType: rawType, eventTime: '2026-05-01T00:00:00Z' }) });
    if (finalType !== undefined || finalPurpose !== undefined) {
      db.prepare('UPDATE events SET final_event_type=?, final_purpose=? WHERE id=?')
        .run(finalType ?? null, finalPurpose ?? 'OPENING_BALANCE', eventId);
    }
    insertJournalEntry(db, {
      id: `je-${eventId}`, entityId: ENTITY, eventId,
      jeJson: JSON.stringify({ idempotencyKey: eventId, lineageHash: 'h', reversalOf: null, lines: acquisitionLines(qty) }),
      idempotencyKey: eventId, leafHash: `leaf-${eventId}`,
    });
  }

  // Rebuild the DTOs with the SAME gate routes.ts eventDTO uses, so this test cannot pass
  // against a wire shape the server never emits. Note the gate is nullish, not truthy:
  // a row with final_purpose set but final_event_type NULL still emits `final`, carrying a
  // null eventType — which is why both sides must use `??` and not `||` to fall back to raw.
  function webMovements() {
    const journal = listJournal(db, ENTITY).map((r) => ({
      id: r.id, eventId: r.eventId, idempotencyKey: r.idempotencyKey, leafHash: r.leafHash,
      je: JSON.parse(r.jeJson) as unknown,
    }));
    const events = [...new Set(journal.map((j) => j.eventId))].map((id) => {
      const e = getEvent(db, id)!;
      return {
        id: e.id, entityId: ENTITY, status: 'POSTED',
        normalized: JSON.parse(e.rawJson) as unknown,
        ai: null,
        final: (e.finalEventType !== null || e.finalPurpose !== null)
          ? { eventType: e.finalEventType, purpose: e.finalPurpose } : null,
        routing: null,
      };
    });
    return recomputeMovements(journal as never, events as never);
  }

  const norm = (m: Record<string, bigint>) =>
    Object.entries(m).map(([k, v]) => [k, v.toString()]).sort();

  it('agrees when an OPENING_LOT sits alongside real movement', () => {
    seed('evt-000-opening', 'OPENING_LOT', '1000000000000'); // 1000 SUI pre-history holding
    seed('evt-001', 'DIGITAL_ASSET_RECEIPT', '5000000000');  // 5 SUI genuine movement
    // Only the receipt is movement. If the client folds the opening lot in, it reports
    // 1005 SUI and the screen shows a ~1000 SUI break that does not exist.
    expect(norm(webMovements())).toEqual(norm(walletAssetMovements(db, ENTITY).byKey));
    expect(norm(walletAssetMovements(db, ENTITY).byKey)).toEqual([[`${WALLET}|${SUI}`, '5000000000']]);
  });

  it('agrees when an event is reclassified AWAY from OPENING_LOT (final wins over raw)', () => {
    seed('evt-001', 'OPENING_LOT', '5000000000', 'DIGITAL_ASSET_RECEIPT');
    expect(norm(webMovements())).toEqual(norm(walletAssetMovements(db, ENTITY).byKey));
    expect(norm(walletAssetMovements(db, ENTITY).byKey)).toEqual([[`${WALLET}|${SUI}`, '5000000000']]);
  });

  it('agrees when an event is reclassified INTO OPENING_LOT (final wins over raw)', () => {
    seed('evt-001', 'DIGITAL_ASSET_RECEIPT', '5000000000', 'OPENING_LOT');
    expect(norm(webMovements())).toEqual(norm(walletAssetMovements(db, ENTITY).byKey));
    expect(norm(walletAssetMovements(db, ENTITY).byKey)).toEqual([]);
  });

  it('agrees when final_purpose is set but final_event_type is NULL (?? not || on both sides)', () => {
    // The DTO's nullish gate emits `final: { eventType: null, purpose: 'OPENING_BALANCE' }`.
    // Both folds must fall through to the RAW type. A `||` on either side would behave the
    // same here by accident — but an `?.eventType ?? raw` vs `.eventType || raw` split is how
    // this pair silently diverges the next time someone "tidies" one of them.
    seed('evt-open', 'OPENING_LOT', '1000000000000', null, 'OPENING_BALANCE');
    seed('evt-001', 'DIGITAL_ASSET_RECEIPT', '5000000000');
    expect(norm(webMovements())).toEqual(norm(walletAssetMovements(db, ENTITY).byKey));
    // raw OPENING_LOT still governs → excluded; only the receipt is movement.
    expect(norm(walletAssetMovements(db, ENTITY).byKey)).toEqual([[`${WALLET}|${SUI}`, '5000000000']]);
  });
});
