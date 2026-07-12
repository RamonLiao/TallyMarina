/**
 * Task 4 (C4 lot store): buildRuleInput folds REAL lots — the hardcoded 'lot-1' literal
 * is gone. These tests pin the two halves of the contract:
 *   1. buildRuleInput forwards opts.lots VERBATIM. Empty lots + a consuming event must
 *      surface the engine's INSUFFICIENT_LOT rejection — proof the fabricated demo lot no
 *      longer masks a missing basis (the whole point of Task 4).
 *   2. lotsForEvent derives the (wallet, coinType) pool from persisted lot_movement rows.
 */
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertLotMovement } from '../src/store/lotMovementStore.js';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
import { lotsForEvent } from '../src/http/lotsForEvent.js';
import { evaluate, type PositionLot, type PricePoint } from '../src/deps/rulesEngine.js';
import type { EventRow } from '../src/store/eventStore.js';
import { DEMO_POLICY_SET, buildCoaMapping } from '../src/http/policyConstants.js';

const E = 'acme:pilot-001';
const WALLET = '0xacmeTreasury';
const COIN = '0x2::sui::SUI';

function paymentRaw(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 'v1', eventId: 'evtPay', eventType: 'DIGITAL_ASSET_PAYMENT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: WALLET, counterparty: '0xvendor', coinType: COIN,
    assetDecimals: 9, quantityMinor: '400000000', eventTime: '2026-04-05T00:00:00Z',
    economicPurpose: 'VENDOR_PAYMENT', ownershipChange: true,
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIGpay', eventIndex: 0, ...over,
  });
}

function eventRow(rawJson: string): EventRow {
  return {
    id: 'pay1', entityId: E, rawJson,
    aiEventType: null, aiPurpose: null, aiCounterparty: null, aiConfidence: null, aiReasoning: null,
    finalEventType: 'DIGITAL_ASSET_PAYMENT', finalPurpose: 'VENDOR_PAYMENT',
    status: 'APPROVED', periodId: '2026-Q2',
  };
}

// D14: these tests probe the LOT contract, not pricing — supply a price directly (bypassing
// the DB) so PRICE_MISSING (phase 6, before the lot phase 7) never masks the assertions below.
const PRICES: PricePoint[] = [
  { id: 'px-test', coinType: COIN, priceCurrency: 'USD', asOfDate: '2026-04-05', unitPriceMinor: '100' },
];

describe('buildRuleInput folds real lots (C4 Task 4)', () => {
  it('forwards empty opts.lots verbatim — a consuming event rejects with INSUFFICIENT_LOT, not a phantom post', () => {
    const input = buildRuleInput(eventRow(paymentRaw()), { periodId: '2026-Q2', periodOpen: true, lots: [], policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping(), prices: PRICES });
    expect(input.lots).toEqual([]); // no fabricated 'lot-1'
    const out = evaluate(input);
    expect(out.decision).toBe('REJECTED');
    expect(out.exceptions.map((e) => e.code)).toContain('INSUFFICIENT_LOT');
  });

  it('forwards a supplied lot verbatim — the consume finds basis and posts', () => {
    const lots: PositionLot[] = [
      { lotId: 'OPEN-x', seq: 1, coinType: COIN, wallet: WALLET, remainingQtyMinor: '1000000000000', costMinor: '1000000' },
    ];
    const input = buildRuleInput(eventRow(paymentRaw()), { periodId: '2026-Q2', periodOpen: true, lots, policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping(), prices: PRICES });
    expect(input.lots).toBe(lots);
    expect(evaluate(input).decision).toBe('POSTABLE');
  });

  it('lotsForEvent folds persisted movements for the event wallet/coinType', () => {
    const db = openDb(':memory:');
    insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    // lot_movement.event_id FKs events(id) — seed the originating event.
    insertEvent(db, { id: 'open1', entityId: E, rawJson: JSON.stringify({ eventTime: '2026-04-01T00:00:00Z' }) });
    insertLotMovement(db, {
      id: 'lm-acq', entityId: E, eventId: 'open1', jeId: null,
      lotId: 'OPEN-open1', lotSeq: '2026-04-01T00:00:00Z|open1', periodId: '2026-Q2',
      coinType: COIN, wallet: WALLET, deltaQtyMinor: '1000000000000', deltaCostMinor: '1000000',
      costBasisMethod: 'FIFO', policySetVersion: 'demo-ps-1', idempotencyKey: 'open1|OPEN-open1',
    });
    const lots = lotsForEvent(db, eventRow(paymentRaw()));
    expect(lots).toEqual([
      { lotId: 'OPEN-open1', seq: 1, coinType: COIN, wallet: WALLET, remainingQtyMinor: '1000000000000', costMinor: '1000000' },
    ]);
    // A wallet with no movements folds to an empty pool.
    const other = lotsForEvent(db, eventRow(paymentRaw({ wallet: '0xother' })));
    expect(other).toEqual([]);
  });
});
