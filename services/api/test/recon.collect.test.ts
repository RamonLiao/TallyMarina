// services/api/test/recon.collect.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { collectBreaks } from '../src/reconciliation/collect.js';

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
    insertEvent(db, { id: 'evt-001', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI' }) });
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

  it('materiality boundary: |break| == threshold is material', () => {
    // USDC fixture: no JE → computed = opening 5000.0; statement 5000.5 → break -0.5 (>= threshold 0.1)
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType === '0xusdc::usdc::USDC')!;
    expect(usdc.breakMinor).toBe('-500000');
    expect(usdc.material).toBe(true);
  });
});
