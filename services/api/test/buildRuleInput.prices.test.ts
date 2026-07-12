/**
 * Task 9 (D14): buildRuleInput takes event-time prices from the caller instead of the
 * fabricated demo price ('unitPriceMinor: 100'). opts.prices flows through verbatim; an
 * empty/omitted list means RuleInput.prices is empty — no more hidden demo price.
 *
 * The route-level test proves the switchover is actually WIRED, not just that the pure
 * function accepts the option: an APPROVED event with NO matching price_points row must
 * fail-closed with PRICE_MISSING (not silently post at a fabricated price). Before this
 * task's routes.ts change, the hardcoded price made this event post successfully — that
 * is exactly the regression this test pins.
 */
import { describe, it, expect } from 'vitest';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
import { evaluate, type PricePoint } from '../src/deps/rulesEngine.js';
import type { EventRow } from '../src/store/eventStore.js';
import { DEMO_POLICY_SET, buildCoaMapping } from '../src/http/policyConstants.js';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';

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

describe('buildRuleInput takes caller-supplied prices, no fabricated demo price (D14)', () => {
  it('opts.prices given → RuleInput.prices uses it verbatim', () => {
    const prices: PricePoint[] = [
      { id: 'px-1', coinType: COIN, priceCurrency: 'USD', asOfDate: '2026-04-05', unitPriceMinor: '777' },
    ];
    const input = buildRuleInput(eventRow(paymentRaw()), {
      periodId: '2026-Q2', periodOpen: true, lots: [], policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping(), prices,
    });
    expect(input.prices).toBe(prices);
    expect(input.prices).not.toEqual([{ id: 'px-1', coinType: COIN, priceCurrency: 'USD', asOfDate: '2026-04-05', unitPriceMinor: '100' }]);
  });

  it('opts.prices omitted → RuleInput.prices is empty (no fabricated 100)', () => {
    const input = buildRuleInput(eventRow(paymentRaw()), {
      periodId: '2026-Q2', periodOpen: true, lots: [], policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping(),
    });
    expect(input.prices).toEqual([]);
  });

  it('opts.prices === [] → RuleInput.prices is empty, and evaluate() fails closed with PRICE_MISSING', () => {
    const input = buildRuleInput(eventRow(paymentRaw()), {
      periodId: '2026-Q2', periodOpen: true, lots: [], policySet: DEMO_POLICY_SET, coaMapping: buildCoaMapping(), prices: [],
    });
    expect(input.prices).toEqual([]);
    const out = evaluate(input);
    expect(out.decision).not.toBe('POSTABLE');
    expect(out.exceptions.map((e) => e.code)).toContain('PRICE_MISSING');
  });
});

describe('route-level: run-rules fails closed on an unseeded event date (D14 wiring)', () => {
  it('an APPROVED payment event with NO price_points row for its event date is skipped, not posted', async () => {
    // buildTestApp(true) seeds price_points for the fixture's OWN dates (2026-06-01/-02) —
    // this test inserts a SEPARATE event on a date with no price row, so pricesForEvent
    // legitimately returns []. Before this task, buildRuleInput's hardcoded 100 would have
    // posted this event regardless.
    const app = await buildTestApp(true);
    // Same period (2026-Q2) as the fixture's own events, but NOT one of the two dates
    // buildTestApp seeded a price for (2026-06-01/-02) — so this is a genuine gap.
    const raw = paymentRaw({ eventId: 'evtNoPrice', txDigest: 'DIGnoprice', eventTime: '2026-05-15T00:00:00Z' });
    insertEvent(app._db, { id: 'no-price-1', entityId: TEST_ENTITY_ID, rawJson: raw });
    setAiSuggestion(app._db, 'no-price-1', {
      aiEventType: 'DIGITAL_ASSET_PAYMENT', aiPurpose: 'VENDOR_PAYMENT', aiCounterparty: null,
      aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
    });

    const r = await app.inject({ method: 'POST', url: `/entities/${TEST_ENTITY_ID}/run-rules`, payload: { periodId: '2026-Q2' } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { posted: number; skipped: number };
    expect(body.skipped).toBeGreaterThanOrEqual(1);

    const exR = await app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/exceptions?periodId=2026-Q2` });
    expect(exR.statusCode).toBe(200);
    const exBody = exR.json() as { exceptions: Array<{ eventId: string; reason: string }> };
    const mine = exBody.exceptions.find((e) => e.eventId === 'no-price-1');
    expect(mine?.reason).toBe('PRICE_MISSING');
  });
});
