// services/api/test/recon.collect.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, setDecision } from '../src/store/eventStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { collectBreaks } from '../src/reconciliation/collect.js';
import { validateReconRows } from '../src/reconciliation/fixture.js';

function seedJe(db: Db, eventId: string, wallet: string, coinType: string, debitQty: string, creditQty: string) {
  const lines = [
    { account: '1000', side: 'DEBIT', amountMinor: debitQty, origCoinType: coinType, origQtyMinor: debitQty, priceRef: null, fxRef: null, leg: 'MAIN' },
    { account: '4000', side: 'CREDIT', amountMinor: creditQty, origCoinType: coinType, origQtyMinor: creditQty, priceRef: null, fxRef: null, leg: 'MAIN' },
  ];
  insertJournalEntry(db, { id: `je-${eventId}`, entityId: 'acme:pilot-001', eventId, jeJson: JSON.stringify({ idempotencyKey: eventId, lineageHash: 'h', reversalOf: null, lines }), idempotencyKey: eventId, leafHash: `leaf-${eventId}` });
}

describe('collectBreaks', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  });

  it('SUI: opening + net JE movement = computed; break vs statement is signed + material', () => {
    insertEvent(db, { id: 'evt-001', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', eventTime: '2026-05-01T00:00:00Z' }) });
    seedJe(db, 'evt-001', '0xacmeTreasury', '0x2::sui::SUI', '5000000000', '1200000000'); // +3.8
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const sui = rows.find((r) => r.coinType === '0x2::sui::SUI')!;
    expect(sui.movementMinor).toBe('3800000000');
    expect(sui.computedMinor).toBe('5000000000');      // opening 1.2 + 3.8
    expect(sui.breakMinor).toBe('1202000000');         // computed 5.0 − statement 3.798
    expect(sui.material).toBe(true);                   // 1.202 >= threshold 1.0
    expect(sui.control.legs).toBe(2);
  });

  it('statement-only asset surfaces via key union with computed=0', () => {
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdt = rows.find((r) => r.coinType === '0xusdt::usdt::USDT')!;
    expect(usdt.computedMinor).toBe('0');
    expect(usdt.breakMinor).toBe('-750000000');        // 0 − 750.0
    expect(usdt.material).toBe(true);
  });

  it('book-only asset surfaces via key union with statementMinor=0 and nonzero signed break', () => {
    insertEvent(db, { id: 'evt-bookonly', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0xrandom::tok::TOK', eventTime: '2026-05-01T00:00:00Z' }) });
    seedJe(db, 'evt-bookonly', '0xacmeTreasury', '0xrandom::tok::TOK', '9000000000', '2000000000'); // net +7000000000
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const tok = rows.find((r) => r.coinType === '0xrandom::tok::TOK')!;
    expect(tok).toBeDefined();
    expect(tok.statementMinor).toBe('0');                // book-only: no fixture entry → opening defaults 0
    expect(tok.computedMinor).toBe('7000000000');        // opening(0) + movement(7000000000)
    expect(tok.movementMinor).toBe('7000000000');
    const brk = BigInt(tok.breakMinor);
    expect(brk).not.toBe(0n);                           // nonzero signed break
    expect(brk).toBe(7000000000n);                      // computed(7e9) − statement(0)
  });

  it('materiality boundary: |break| == threshold is material', () => {
    // USDC fixture: no JE → computed = opening 5000.0; statement 5000.5 → break -0.5 (>= threshold 0.1)
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType === '0xusdc::usdc::USDC')!;
    expect(usdc.breakMinor).toBe('-500000');
    expect(usdc.material).toBe(true);
  });
});

describe('collectBreaks — OPENING_LOT legs excluded from book movement (dual-review R1 #3)', () => {
  // WHY: OPENING_LOT declares a pre-history holding. Its chain-side counterpart is the recon
  // fixture's openingMinor (which already includes the holding), NOT period movement. Folding
  // the opening JE's ACQUISITION leg into book movements double-counts the same holding on both
  // sides of computed = opening + movement, manufacturing a material break every close.
  const OPEN_ENTITY = 'opening-lot-recon-test:entity';
  const WALLET = '0xopenwallet';
  const COIN = '0xopen::tok::TOK';
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare(
      "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, 'OpenLotTest', '0x1', '0x2', '0x3')",
    ).run(OPEN_ENTITY);
  });

  it('non-zero OPENING_LOT already covered by fixture openingMinor produces NO material break', () => {
    insertEvent(db, {
      id: 'open-evt-1', entityId: OPEN_ENTITY,
      rawJson: JSON.stringify({ wallet: WALLET, coinType: COIN, eventType: 'OPENING_LOT', eventTime: '2026-05-01T00:00:00Z' }),
    });
    // Mirrors openingLotRules.buildJeLines: ACQUISITION leg carries origQtyMinor/origCoinType
    // (merkle anchoring); OPENING_EQUITY leg does not.
    insertJournalEntry(db, {
      id: 'je-open-evt-1', entityId: OPEN_ENTITY, eventId: 'open-evt-1',
      jeJson: JSON.stringify({
        idempotencyKey: 'open-evt-1', lineageHash: 'h', reversalOf: null,
        lines: [
          { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '1000', origCoinType: COIN, origQtyMinor: '300000000', priceRef: null, fxRef: null, leg: 'ACQUISITION' },
          { account: 'OpeningBalanceEquity', side: 'CREDIT', amountMinor: '1000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
        ],
      }),
      idempotencyKey: 'open-evt-1', leafHash: 'leaf-open-evt-1',
    });
    const rows = collectBreaks(db, OPEN_ENTITY, '2026-Q2');
    const row = rows.find((r) => r.wallet === WALLET && r.coinType === COIN)!;
    expect(row).toBeDefined();
    expect(row.movementMinor).toBe('0');          // OPENING_LOT leg excluded from book movement
    expect(row.computedMinor).toBe('300000000');  // opening(fixture) + movement(0)
    expect(row.material).toBe(false);              // computed matches statement exactly — no break
  });

  it('raw OPENING_LOT reclassified via human review to DIGITAL_ASSET_RECEIPT: its JE movement IS counted (re-review F1)', () => {
    // WHY: the posted JE is built from (finalEventType ?? rawEvent.eventType) — see
    // buildRuleInput.ts. If recon's exclusion checked only rawEvent.eventType, a raw
    // OPENING_LOT reclassified to a real receipt would still be treated as opening-only
    // and its genuine period movement would be silently dropped from the fold, masking
    // a real break. finalEventType must win here exactly like it wins for posting.
    insertEvent(db, {
      id: 'open-evt-reclass', entityId: OPEN_ENTITY,
      rawJson: JSON.stringify({ wallet: WALLET, coinType: COIN, eventType: 'OPENING_LOT', eventTime: '2026-05-01T00:00:00Z' }),
    });
    setAiSuggestion(db, 'open-evt-reclass', {
      aiEventType: 'OPENING_LOT', aiPurpose: 'X', aiCounterparty: null, aiConfidence: 0.4,
      aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    });
    setDecision(db, 'open-evt-reclass', { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'RECEIVABLE_SETTLEMENT' });
    insertJournalEntry(db, {
      id: 'je-open-evt-reclass', entityId: OPEN_ENTITY, eventId: 'open-evt-reclass',
      jeJson: JSON.stringify({
        idempotencyKey: 'open-evt-reclass', lineageHash: 'h', reversalOf: null,
        lines: [
          { account: '1000', side: 'DEBIT', amountMinor: '500000000', origCoinType: COIN, origQtyMinor: '500000000', priceRef: null, fxRef: null, leg: 'MAIN' },
          { account: '4000', side: 'CREDIT', amountMinor: '0', origCoinType: COIN, origQtyMinor: '0', priceRef: null, fxRef: null, leg: 'MAIN' },
        ],
      }),
      idempotencyKey: 'open-evt-reclass', leafHash: 'leaf-open-evt-reclass',
    }); // net +500000000
    const rows = collectBreaks(db, OPEN_ENTITY, '2026-Q2');
    const row = rows.find((r) => r.wallet === WALLET && r.coinType === COIN)!;
    expect(row).toBeDefined();
    expect(row.movementMinor).toBe('500000000'); // counted, not excluded — finalEventType overrides raw OPENING_LOT
  });
});

describe('collectBreaks — fixture-less entity (missing vs malformed)', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    // 'no-fixture:entity' exists as an entity but has no recon fixture in the fixture file
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('no-fixture:entity','NoFixture','0x10','0x20','0x30')").run();
  });

  it('fixture-less entity with no JEs → collectBreaks returns [] without throwing', () => {
    // WHY: any entity without a recon fixture must not 500; recon gate is vacuously satisfied
    expect(() => collectBreaks(db, 'no-fixture:entity', '2026-Q2')).not.toThrow();
    const rows = collectBreaks(db, 'no-fixture:entity', '2026-Q2');
    expect(rows).toHaveLength(0);
  });

  it('fixture-less entity WITH JEs → book-only rows surface without throwing', () => {
    // WHY: two-directional design — book movements always surface even without a fixture
    insertEvent(db, { id: 'evt-nf-001', entityId: 'no-fixture:entity', rawJson: JSON.stringify({ wallet: '0xwallet', coinType: '0xtoken::tok::TOK', eventTime: '2026-05-01T00:00:00Z' }) });
    insertJournalEntry(db, {
      id: 'je-nf-001', entityId: 'no-fixture:entity', eventId: 'evt-nf-001',
      jeJson: JSON.stringify({ idempotencyKey: 'evt-nf-001', lineageHash: 'h', reversalOf: null,
        lines: [
          { account: '1000', side: 'DEBIT', amountMinor: '1000', origCoinType: '0xtoken::tok::TOK', origQtyMinor: '1000', priceRef: null, fxRef: null, leg: 'MAIN' },
          { account: '4000', side: 'CREDIT', amountMinor: '500', origCoinType: '0xtoken::tok::TOK', origQtyMinor: '500', priceRef: null, fxRef: null, leg: 'MAIN' },
        ] }),
      idempotencyKey: 'evt-nf-001', leafHash: 'leaf-nf-001',
    });
    const rows = collectBreaks(db, 'no-fixture:entity', '2026-Q2');
    expect(rows.length).toBeGreaterThan(0);
    const tok = rows.find((r) => r.coinType === '0xtoken::tok::TOK');
    expect(tok).toBeDefined();
    expect(tok!.statementMinor).toBe('0');      // no fixture → statement defaults 0
    expect(tok!.movementMinor).toBe('500');     // net debit - credit
  });

  it('malformed fixture (non-array raw) → validateReconRows throws (fail-loud)', () => {
    // WHY: missing = not configured (soft); malformed = corruption (hard, must throw)
    // validateReconRows is the same path collectBreaks goes through; non-array triggers throw
    expect(() => validateReconRows('not-an-array', 'any:entity')).toThrow('no recon fixture for entity any:entity');
  });

  it('malformed fixture (negative minor) → validateReconRows throws', () => {
    // WHY: a well-formed array with invalid data is corruption, not missing
    const badRows = [{ wallet: '0xw', coinType: '0x::t::T', decimals: 9, openingMinor: '-1', statementMinor: '0', thresholdMinor: '0' }];
    expect(() => validateReconRows(badRows, 'any:entity')).toThrow();
  });

  it('malformed fixture (duplicate rows) → validateReconRows throws', () => {
    const dupRows = [
      { wallet: '0xw', coinType: '0x::t::T', decimals: 9, openingMinor: '0', statementMinor: '0', thresholdMinor: '0' },
      { wallet: '0xw', coinType: '0x::t::T', decimals: 9, openingMinor: '0', statementMinor: '0', thresholdMinor: '0' },
    ];
    expect(() => validateReconRows(dupRows, 'any:entity')).toThrow('duplicate');
  });
});
