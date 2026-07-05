import type { EventStrategy, LotPlan } from './registry.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { balanceCheck } from './receiptRules.js';

// OPENING_LOT (C4 spec §3 + opening-equity-je spec): originates a pre-history lot with one
// positive movement. Non-zero historical cost ALSO emits Dr <asset>/Cr <opening equity> so the
// declared basis (and qty/coinType via the leaf codec) is merkle-anchored. Zero-basis lots
// (airdrops) stay JE-less by design (spec D2) — the §7.8.3 JE-less POSTABLE branch remains.
// Canonical form only (no leading zeros): a loose /^[0-9]+$/ would accept '00', which passes
// this regex but fails the `cost === '0'` zero-basis check below, emitting a ZERO-amount JE
// that wrongly enters the merkle spine — and would accept '007', anchoring a non-canonical
// amount string verbatim via the leaf codec.
const COST_RE = /^(0|[1-9][0-9]*)$/;

export const openingLotStrategy: EventStrategy = {
  ruleIds: ['opening-lot-origination-v1', 'opening-equity-je-v1'],
  requiresValuation: false, // historical cost comes from the event payload, never repriced
  classify: () => null,
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const cost = event.openingCostMinor;
    if (!cost || !COST_RE.test(cost)) {
      return { phase: 7, code: 'SCHEMA_INVALID', detail: 'OPENING_LOT requires openingCostMinor (non-negative integer string)' };
    }
    return {
      movements: [{
        lotId: `OPEN-${event.eventId}`, coinType: event.coinType, wallet: event.wallet,
        deltaQtyMinor: event.quantityMinor, deltaCostMinor: cost,
      }],
      consumed: [],
    };
  },
  buildMeasurements: (): Measurement[] => [],
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event } = ctx.input;
    const cost = event.openingCostMinor;
    if (!cost || !COST_RE.test(cost)) {
      return { phase: 7, code: 'SCHEMA_INVALID', detail: 'OPENING_LOT requires openingCostMinor (non-negative integer string)' };
    }
    if (cost === '0') return []; // D2: zero-basis lots are JE-less and unanchored by design
    const assetAccount = ctx.input.coaMapping.resolve({ eventType: 'OPENING_LOT', leg: 'ACQUISITION', coinType: event.coinType });
    const equityAccount = ctx.input.coaMapping.resolve({ eventType: 'OPENING_LOT', leg: 'OPENING_EQUITY', coinType: event.coinType });
    if (!assetAccount || !equityAccount) return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, equityAccount } };
    return balanceCheck([
      // origCoinType/origQtyMinor follow every existing ACQUISITION leg — the leaf codec anchors
      // them, so the declared quantity and coinType are merkle-anchored too (spec §3.1).
      { account: assetAccount, side: 'DEBIT', amountMinor: cost, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'ACQUISITION' },
      { account: equityAccount, side: 'CREDIT', amountMinor: cost, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
    ]);
  },
  buildDisclosure: (ctx): DisclosureFact[] =>
    [{ kind: 'opening_lot', detail: { units: ctx.input.event.quantityMinor, cost: ctx.input.event.openingCostMinor } }],
};
